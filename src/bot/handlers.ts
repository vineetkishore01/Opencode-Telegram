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
  messageQueue: MessageQueue,
  authorizedUserId: string
) {
  const log = getLogger()

  bot.on('message:text', async (ctx) => {
    try {
      if (!ctx.from) return
      const userId = ctx.from.id.toString()
      const text = ctx.message.text
      log.info('Incoming message', { userId, chatId: ctx.chat.id, text })

      if (userId !== authorizedUserId) {
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

      const isQueueBusy = messageQueue.isBusy(ctx.chat.id)
      
      // Check actual OpenCode session status - only queue if session is actually busy
      let sessionActuallyBusy = false
      if (isQueueBusy) {
        try {
          const sessionInfo = await client.getSession(sessionId)
          sessionActuallyBusy = (sessionInfo as any).status?.type === 'busy'
        } catch (e) {
          // If we can't check status, assume busy to be safe
          sessionActuallyBusy = true
        }
      }

      if (isQueueBusy && sessionActuallyBusy) {
        const position = messageQueue.getQueueLength(ctx.chat.id) + 1
        messageQueue.enqueue(ctx.chat.id, text)
        await ctx.reply(`📋 Queued (position ${position}). Will process when current task finishes.`)
        return
      }

      // Session is actually idle - clear queue busy state and process immediately
      if (isQueueBusy && !sessionActuallyBusy) {
        messageQueue.setIdle(ctx.chat.id)
      }

      const model = stateManager.getCurrentModel(ctx.chat.id)
      const mode = stateManager.getCurrentMode(ctx.chat.id)

      messageQueue.setBusy(ctx.chat.id)

      const workingMsg = await ctx.reply('⏳ OpenCode is working...').catch(() => null)
      eventProcessor.setWorkingMessage(sessionId, ctx.chat.id, workingMsg?.message_id || 0)
      eventProcessor.resetActivityTimer(sessionId)

      await client.sendAsyncMessage(sessionId, text, {
        providerId: model?.providerId,
        modelId: model?.modelId,
        agent: mode,
      })

      const count = stateManager.incrementPromptCount(ctx.chat.id)
      if (count > 0 && count % 10 === 0) {
        await ctx.reply(`📊 You've sent ${count} prompts. Use /cost to check spending.`)
      }

      log.info('Sent to OpenCode', { sessionId })
    } catch (error) {
      log.error('Handler error', { error: (error as Error).message })
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
    log.info('Incoming callback', { userId, chatId: ctx.chat?.id, data })

    if (userId !== authorizedUserId) {
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

    if (data.startsWith('models_page:')) {
      return
    }

    await ctx.answerCallbackQuery()
  })

  bot.catch((err) => {
    log.error('Bot error', { error: err.message })
  })
}
