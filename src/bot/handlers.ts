import { Bot } from 'grammy'
import { StateManager } from '../state/manager.js'
import { OpenCodeClient } from '../opencode/client.js'
import { PermissionHandler } from '../opencode/permission.js'
import { EventProcessor } from '../opencode/events.js'
import { MessageQueue } from './queue.js'
import { getLogger } from '../utils/logger.js'

export function registerHandlers(
  bot: Bot,
  stateManager: StateManager,
  client: OpenCodeClient,
  permissionHandler: PermissionHandler,
  eventProcessor: EventProcessor,
  messageQueue: MessageQueue
) {
  const log = getLogger()

  // Handle text messages
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id.toString()
    const text = ctx.message.text
    log.info('Incoming message', { userId, chatId: ctx.chat.id, text })

    if (userId !== process.env.AUTHORIZED_USER_ID) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    // Skip if it's a command
    if (text.startsWith('/')) {
      return
    }

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (!sessionId) {
      await ctx.reply('No session selected. Use /session to create or select one.')
      return
    }

    // If session is busy, queue the message
    if (messageQueue.isBusy(ctx.chat.id)) {
      const position = messageQueue.getQueueLength(ctx.chat.id) + 1
      messageQueue.enqueue(ctx.chat.id, text)
      await ctx.reply(`📋 Queued (position ${position}). Will process when current task finishes.`)
      return
    }

    // Get selected model and mode if any
    const selectedModel = stateManager.getCurrentModel(ctx.chat.id)
    const selectedMode = stateManager.getCurrentMode(ctx.chat.id)

    // Increment prompt counter
    const count = stateManager.incrementPromptCount(ctx.chat.id)
    if (count > 0 && count % 10 === 0) {
      await ctx.reply(`📊 You've sent ${count} prompts. Use /cost to check spending.`)
    }

    // Mark session as busy
    messageQueue.setBusy(ctx.chat.id)

    // Send "working" message
    const workingMsg = await ctx.reply('⏳ OpenCode is working...')

    // Store the working message so we can update it when done
    eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, workingMsg.message_id)

    try {
      // Send async message to OpenCode with model and mode selection
      await client.sendAsyncMessage(sessionId, text, {
        providerId: selectedModel?.providerId,
        modelId: selectedModel?.modelId,
        agent: selectedMode,
      })

      log.info('Sent to OpenCode')
    } catch (error) {
      log.error('Failed to send message', { error: (error as Error).message })
      messageQueue.setIdle(ctx.chat.id)

      await ctx.api.editMessageText(
        ctx.chat.id,
        workingMsg.message_id,
        `❌ Error: ${(error as Error).message}`
      )
    }

    // CRITICAL: Always set idle after sending, since prompt_async returns immediately
    // The event processor will re-set busy when it detects the session is actually working
    // This prevents permanent stalling if the poll misses the idle transition
    messageQueue.setIdle(ctx.chat.id)
  })

  // Handle callback queries (inline buttons)
  bot.on('callback_query:data', async (ctx) => {
    const userId = ctx.from?.id.toString()
    const data = ctx.callbackQuery.data
    log.info('Incoming callback', { userId, chatId: ctx.chat?.id, data })

    if (userId !== process.env.AUTHORIZED_USER_ID) {
      await ctx.answerCallbackQuery('Not authorized')
      return
    }

    // Permission callbacks
    if (data.startsWith('perm:')) {
      await permissionHandler.handlePermissionReply(ctx.callbackQuery)
      return
    }

    // Question callbacks: q:<questionId>:<answerIndex> or q:reject:<questionId>
    if (data.startsWith('q:')) {
      const parts = data.split(':')
      if (parts[1] === 'reject') {
        const questionId = parts[2]
        try {
          await client.rejectQuestion(questionId)
          await ctx.answerCallbackQuery('Question dismissed')
          await ctx.editMessageText('❌ Question dismissed')
        } catch (error) {
          log.error('Failed to reject question', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed to dismiss')
        }
      } else {
        const questionId = parts[1]
        const answerIndex = parseInt(parts[2], 10)
        try {
          await client.replyQuestion(questionId, [String(answerIndex)])
          const buttonText = `Option ${answerIndex + 1}`
          await ctx.answerCallbackQuery(`Selected: ${buttonText}`)
          await ctx.editMessageText(`✅ Answered: ${buttonText}`)
        } catch (error) {
          log.error('Failed to reply to question', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed to answer')
        }
      }
      return
    }

    // Session selection callbacks
    if (data.startsWith('session:')) {
      const sessionId = data.replace('session:', '')
      stateManager.setCurrentSession(ctx.chat!.id, sessionId)

      await ctx.answerCallbackQuery('Session selected')
      await ctx.editMessageText(`✅ Session selected: \`${sessionId}\``, { parse_mode: 'Markdown' })
      return
    }

    // Model page navigation
    if (data.startsWith('models_page:')) {
      // Handled by commands.ts
      return
    }

    await ctx.answerCallbackQuery()
  })

  // Handle errors
  bot.catch((err) => {
    log.error('Bot error', { error: err.message })
  })
}
