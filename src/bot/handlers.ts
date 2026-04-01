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
  authorizedUserId: string,
  permissionHandler: PermissionHandler,
  eventProcessor: EventProcessor,
  messageQueue: MessageQueue
) {
  const log = getLogger()

  bot.on('message:text', async (ctx) => {
    try {
      if (!ctx.from) return
      const userId = ctx.from.id.toString()
      const text = ctx.message.text
      log.info('Incoming message', { userId, chatId: ctx.chat.id, text: text.substring(0, 100) })

      if (userId !== authorizedUserId) {
        log.warn('Unauthorized access attempt', { userId, chatId: ctx.chat.id })
        await ctx.reply('You are not authorized to use this bot.')
        return
      }

      if (text.startsWith('/')) return

      if (text.length > 4096) {
        await ctx.reply('Message too long. Maximum is 4096 chars.')
        return
      }

      const sessionId = stateManager.getCurrentSession(ctx.chat.id)
      if (!sessionId) {
        await ctx.reply('No session selected. Use /session to create or select one.')
        return
      }

      // Register session for event tracking if not already tracked
      eventProcessor.trackSession(sessionId, ctx.chat.id)

      // Atomically check if session is working and queue if needed
      if (eventProcessor.isSessionWorking(sessionId) || messageQueue.isBusy(ctx.chat.id)) {
        // Queue the message atomically (prevents race condition)
        const wasQueued = messageQueue.tryEnqueueAndSetBusy(ctx.chat.id, text)
        if (wasQueued) {
          const position = messageQueue.getQueueLength(ctx.chat.id)
          log.info('Message queued', { sessionId, position })
          await ctx.reply(`📋 Queued (position ${position}). Will process when current task finishes.`)
        } else {
          log.debug('Duplicate message ignored', { sessionId })
        }
        return
      }

      // Send working message
      const workingMsg = await ctx.reply('⏳ OpenCode is working...').catch(() => null)

      // Create tracker BEFORE sending to prevent race conditions
      // Use messageId 0 as sentinel if working message failed to send
      const workingMessageId = workingMsg?.message_id || 0
      eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, workingMessageId)
      if (workingMsg) {
        log.debug('Working message set', { sessionId, messageId: workingMsg.message_id })
      } else {
        log.warn('Failed to send working message, using sentinel', { sessionId })
      }

      messageQueue.setBusy(ctx.chat.id)

      const model = stateManager.getCurrentModel(ctx.chat.id)
      const mode = stateManager.getCurrentMode(ctx.chat.id)

      log.info('Relaying to OpenCode', { sessionId, text: text.substring(0, 50) })

      // Fire-and-forget to avoid blocking handler
      client.sendAsyncMessage(sessionId, text, {
        providerId: model?.providerId,
        modelId: model?.modelId,
        agent: mode,
      }).catch((error: Error) => {
        log.error('Failed to relay to OpenCode', { error: error.message })
        messageQueue.setIdle(ctx.chat.id)
        ctx.reply(`❌ Error: ${error.message.substring(0, 500)}`).catch(() => {})
      })

      stateManager.incrementPromptCount(ctx.chat.id)
    } catch (error) {
      log.error('Handler error', { error: (error as Error).message })
      const sessionId = stateManager.getCurrentSession(ctx.chat.id)
      if (sessionId) {
        eventProcessor.markSessionIdle(sessionId)
      }
      messageQueue.setIdle(ctx.chat.id)
      ctx.reply(`❌ Error: ${(error as Error).message.substring(0, 500)}`).catch(() => {})
    }
  })

  bot.on('callback_query:data', async (ctx) => {
    if (!ctx.from) {
      log.warn('Callback received without sender info')
      await ctx.answerCallbackQuery()
      return
    }
    const userId = ctx.from.id.toString()
    const data = ctx.callbackQuery.data
    log.info('Incoming callback', { userId, chatId: ctx.chat?.id, data: data.substring(0, 50) })

    if (userId !== authorizedUserId) {
      log.warn('Unauthorized callback attempt', { userId, data: data.substring(0, 50) })
      await ctx.answerCallbackQuery('Not authorized')
      return
    }

    if (data.startsWith('perm:')) {
      await permissionHandler.handlePermissionReply(ctx.callbackQuery)
      return
    }

    if (data.startsWith('q:')) {
      const parts = data.split(':')
      if (parts[1] === 'reject') {
        const questionId = parts[2]
        if (!questionId) {
          await ctx.answerCallbackQuery('Invalid data')
          return
        }
        try {
          await client.rejectQuestion(questionId)
          await ctx.editMessageText('❌ Question dismissed').catch(() => {})
          await ctx.answerCallbackQuery('Question dismissed')
        } catch (error) {
          log.error('Failed to reject question', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed to dismiss')
        }
      } else {
        const questionId = parts[1]
        const answerIdx = parseInt(parts[2], 10)
        if (!questionId || isNaN(answerIdx)) {
          await ctx.answerCallbackQuery('Invalid data')
          return
        }
        try {
          await client.replyQuestion(questionId, [String(answerIdx)])
          const buttonText = `Option ${answerIdx + 1}`
          await ctx.editMessageText(`✅ Answered: ${buttonText}`).catch(() => {})
          await ctx.answerCallbackQuery(`Selected: ${buttonText}`)
        } catch (error) {
          log.error('Failed to reply to question', { error: (error as Error).message })
          await ctx.answerCallbackQuery('Failed to answer')
        }
      }
      return
    }

    if (data.startsWith('session:')) {
      const sessionId = data.replace('session:', '')
      if (!sessionId) {
        await ctx.answerCallbackQuery('Invalid session')
        return
      }
      if (!ctx.chat) {
        log.warn('Callback without chat info')
        await ctx.answerCallbackQuery()
        return
      }
      stateManager.setCurrentSession(ctx.chat.id, sessionId)

      await ctx.answerCallbackQuery('Session selected')
      await ctx.editMessageText(`✅ Session selected: \`${sessionId}\``, { parse_mode: 'Markdown' }).catch(() => {})
      return
    }

    await ctx.answerCallbackQuery()
  })

  bot.catch((err) => {
    log.error('Bot error', { error: err.message })
  })
}
