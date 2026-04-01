import { Bot } from 'grammy'
import { StateManager } from '../state/manager.js'
import { OpenCodeClient, Model, Provider } from '../opencode/client.js'
import { EventProcessor } from '../opencode/events.js'
import { MessageQueue } from './queue.js'
import { escapeMarkdown, splitMessage } from '../utils/formatter.js'
import { getLogger } from '../utils/logger.js'

// Shared help text for /start and /help commands
const HELP_TEXT =
  '*OpenCode Telegram Bot*\n\n' +
  '*Session Commands:*\n' +
  '/session - Create new session\n' +
  '/session <id> - Select existing session\n' +
  '/sessions - List recent sessions\n' +
  '/continue - Continue old session (interactive)\n' +
  '/status - Show current status\n' +
  '/abort - Stop running task\n' +
  '/delete - Delete current session\n' +
  '/reset - Reset status\n\n' +
  '*Model Commands:*\n' +
  '/providers - List AI providers\n' +
  '/models <provider> - List models for provider\n' +
  '/model <provider> <model> - Select model\n\n' +
  '*Mode Commands:*\n' +
  '/mode <name> - Select mode (e.g. build/plan)\n\n' +
  '*File Commands:*\n' +
  '/files [path] - List files in directory\n' +
  '/file <path> - View file content\n' +
  '/find <pattern> - Search code\n\n' +
  '*Info Commands:*\n' +
  '/cost - Show cost tracking\n' +
  '/todo - Show task list\n' +
  '/diff - Show file changes\n\n' +
  '*Usage:*\n' +
  'Just send any message to prompt OpenCode!'

export function registerCommands(
  bot: Bot,
  stateManager: StateManager,
  client: OpenCodeClient,
  authorizedUserId: string,
  eventProcessor: EventProcessor,
  messageQueue: MessageQueue
) {
  const log = getLogger()

  // Helper to check authorization
  const isAuthorized = (userId?: string) => userId === authorizedUserId

  // Start command
  bot.command('start', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' })
  })

  // Session command
  bot.command('session', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/session', args: ctx.match, userId: ctx.from?.id })

    const args = ctx.match as string
    if (args) {
      try {
        const session = await client.getSession(args)
        stateManager.setCurrentSession(ctx.chat.id, session.id)
        eventProcessor.resetTracking(session.id)
        eventProcessor.trackSession(session.id, ctx.chat.id)
        await ctx.reply(`Selected session: \`${escapeMarkdown(session.id)}\``, {
          parse_mode: 'Markdown',
        })
      } catch (error) {
        await ctx.reply(`Session not found: ${(error as Error).message}`)
      }
    } else {
      try {
        const session = await client.createSession()
        stateManager.setCurrentSession(ctx.chat.id, session.id)
        eventProcessor.resetTracking(session.id)
        eventProcessor.trackSession(session.id, ctx.chat.id)
        await ctx.reply(`Created new session: \`${escapeMarkdown(session.id)}\`\n\nSend any message to start!`, {
          parse_mode: 'Markdown',
        })
      } catch (error) {
        await ctx.reply(`Failed to create session: ${(error as Error).message}`)
      }
    }
  })

  // Continue command
  bot.command('continue', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/continue', userId: ctx.from?.id })

    try {
      const sessions = await client.listSessions({ limit: 10 })

      if (sessions.length === 0) {
        await ctx.reply('No sessions found. Use /session to create a new one.')
        return
      }

      const inlineKeyboard = sessions.map((s) => {
        const title = s.title || s.id.slice(0, 20)
        return [{ text: title, callback_data: `session:${s.id}` }]
      })

      await ctx.reply('*Select a session to continue:*', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      })
    } catch (error) {
      await ctx.reply(`Failed to list sessions: ${(error as Error).message}`)
    }
  })

  // Sessions command
  bot.command('sessions', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/sessions', userId: ctx.from?.id })

    try {
      const sessions = await client.listSessions({ limit: 10 })
      if (sessions.length === 0) {
        await ctx.reply('No sessions found.')
        return
      }

      let message = '*Recent Sessions:*\n\n'
      for (const s of sessions) {
        const title = s.title || '(untitled)'
        message += `- \`${escapeMarkdown(s.id)}\`\n  ${escapeMarkdown(title)}\n\n`
      }
      message += 'Use `/session <id>` to select a session.'

      await ctx.reply(message, { parse_mode: 'Markdown' })
    } catch (error) {
      await ctx.reply(`Failed to list sessions: ${(error as Error).message}`)
    }
  })

  // Abort command
  bot.command('abort', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/abort', userId: ctx.from?.id })

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (!sessionId) {
      await ctx.reply('No session selected.')
      return
    }

    try {
      await client.abortSession(sessionId)
      eventProcessor.resetTracking(sessionId)
      await ctx.reply('🛑 Session aborted and relay state reset.')
    } catch (error) {
      await ctx.reply(`Failed to abort: ${(error as Error).message}`)
    }
  })

  // Delete command
  bot.command('delete', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/delete', userId: ctx.from?.id })

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (!sessionId) {
      await ctx.reply('No session selected.')
      return
    }

    try {
      await client.deleteSession(sessionId)
      eventProcessor.resetTracking(sessionId)
      stateManager.clearChatState(ctx.chat.id)
      await ctx.reply(`🗑️ Session \`${escapeMarkdown(sessionId)}\` deleted.`, { parse_mode: 'Markdown' })
    } catch (error) {
      await ctx.reply(`Failed to delete: ${(error as Error).message}`)
    }
  })

  // Reset command
  bot.command('reset', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/reset', userId: ctx.from?.id })
    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (sessionId) {
      eventProcessor.resetTracking(sessionId)
    }
    await ctx.reply('🧹 Relay tracking state reset.')
  })

  // Clear command
  bot.command('clear', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/clear', userId: ctx.from?.id })

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (sessionId) {
      eventProcessor.resetTracking(sessionId)
    }
    messageQueue.clear(ctx.chat.id)
    stateManager.clearChatState(ctx.chat.id)
    await ctx.reply('Cleared current session, model, and mode settings.')
  })

  // Status command
  bot.command('status', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/status', userId: ctx.from?.id })

    const chatState = stateManager.getChatState(ctx.chat.id)

    let message = '*Current Status*\n\n'

    if (chatState.sessionId) {
      try {
        const session = await client.getSession(chatState.sessionId)
        const sessionTitle = session.title || '(untitled)'
        message += `*Session:*\n`
        message += `ID: \`${escapeMarkdown(session.id)}\`\n`
        message += `Title: ${escapeMarkdown(sessionTitle)}\n`
        message += `Directory: \`${escapeMarkdown(session.directory)}\`\n`

        if ((session as any).summary) {
          const summary = (session as any).summary
          message += `Changes: +${summary.additions || 0} -${summary.deletions || 0} (${summary.files || 0} files)\n`
        }
        message += '\n'
      } catch {
        message += `*Session:* \`${escapeMarkdown(chatState.sessionId)}\` (not found)\n\n`
      }
    } else {
      message += `*Session:* Not selected (use /session)\n\n`
    }

    if (chatState.model) {
      message += `*Model:*\n`
      message += `${escapeMarkdown(chatState.model.providerId)}/${escapeMarkdown(chatState.model.modelId)}\n\n`
    } else {
      message += `*Model:* (OpenCode default)\n\n`
    }

    if (chatState.mode) {
      message += `*Mode:* \`${escapeMarkdown(chatState.mode)}\`\n`
    } else {
      message += `*Mode:* (OpenCode default)\n`
    }

    if (chatState.sessionId) {
      const cost = stateManager.getCost(chatState.sessionId)
      if (cost && cost.totalCost > 0) {
        message += `\n*Cost:* $${cost.totalCost.toFixed(4)} (${cost.messages} messages)\n`
      }
    }

    const promptCount = stateManager.getPromptCount(ctx.chat.id)
    if (promptCount > 0) {
      message += `\n_Prompts sent: ${promptCount}_`
    }

    await ctx.reply(message, { parse_mode: 'Markdown' })
  })

  // Cost command
  bot.command('cost', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/cost', userId: ctx.from?.id })

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (!sessionId) {
      await ctx.reply('No session selected. Use /session to create one.')
      return
    }

    const cost = stateManager.getCost(sessionId)
    if (!cost || cost.messages === 0) {
      await ctx.reply('No cost data for this session yet.')
      return
    }

    let message = `*Cost Tracking*\n\n`
    message += `*Total:* $${cost.totalCost.toFixed(4)}\n`
    message += `*Messages:* ${cost.messages}\n`
    message += `*Avg/Message:* $${(cost.totalCost / cost.messages).toFixed(4)}\n\n`
    message += `*Tokens:*\n`
    message += `  Input: ${cost.totalInput.toLocaleString()}\n`
    message += `  Output: ${cost.totalOutput.toLocaleString()}\n`
    message += `  Reasoning: ${cost.totalReasoning.toLocaleString()}\n`

    await ctx.reply(message, { parse_mode: 'Markdown' })
  })

  // Todo command
  bot.command('todo', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (!sessionId) {
      await ctx.reply('No session selected.')
      return
    }

    try {
      const todos = await client.getSessionTodo(sessionId)
      if (todos.length === 0) {
        await ctx.reply('No tasks in this session.')
        return
      }

      const statusIcon: Record<string, string> = {
        completed: '✅', in_progress: '🔄', pending: '⬜', cancelled: '❌',
      }

      let message = `📋 *Task List:*\n\n`
      for (const todo of todos) {
        const icon = statusIcon[todo.status] || '⬜'
        const content = todo.content?.substring(0, 80) || ''
        message += `${icon} ${escapeMarkdown(content)}\n`
      }

      await ctx.reply(message, { parse_mode: 'Markdown' })
    } catch (error) {
      await ctx.reply(`Failed to get tasks: ${(error as Error).message}`)
    }
  })

  // Diff command
  bot.command('diff', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const sessionId = stateManager.getCurrentSession(ctx.chat.id)
    if (!sessionId) {
      await ctx.reply('No session selected.')
      return
    }

    try {
      const diffs = await client.getSessionDiff(sessionId)
      if (diffs.length === 0) {
        await ctx.reply('No file changes in this session.')
        return
      }

      let message = `📁 *File Changes:*\n\n`
      for (const diff of diffs) {
        const statusIcon = diff.status === 'added' ? '🆕' : diff.status === 'deleted' ? '🗑️' : '📝'
        message += `${statusIcon} \`${escapeMarkdown(diff.file)}\` (+${diff.additions} -${diff.deletions})\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
      }
    } catch (error) {
      await ctx.reply(`Failed to get diff: ${(error as Error).message}`)
    }
  })

  // Files command
  bot.command('files', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/files', args: ctx.match, userId: ctx.from?.id })

    const dirPath = (ctx.match as string || '').trim() || undefined

    // Basic path traversal prevention
    if (dirPath && dirPath.includes('..')) {
      await ctx.reply('❌ Path traversal not allowed. Use absolute paths or stay within project.')
      return
    }

    try {
      const result = await client.listFiles(dirPath)
      const entries = result.entries || []

      if (entries.length === 0) {
        await ctx.reply('📂 Empty directory or not found.')
        return
      }

      let message = `📂 *Directory:*\n\n`
      for (const entry of entries) {
        const icon = entry.isDir ? '📁' : '📄'
        const name = entry.name || entry.path
        message += `${icon} \`${escapeMarkdown(name)}\`\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
      }
    } catch (error) {
      await ctx.reply(`Failed to list files: ${(error as Error).message}`)
    }
  })

  // File command
  bot.command('file', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const filePath = (ctx.match as string || '').trim()

    log.info('User command', { command: '/file', args: filePath, userId: ctx.from?.id })

    if (!filePath) {
      await ctx.reply('Usage: `/file <path>`\nExample: `/file src/index.ts`', { parse_mode: 'Markdown' })
      return
    }

    // Basic path traversal prevention
    if (filePath.includes('..')) {
      await ctx.reply('❌ Path traversal not allowed. Use absolute paths or stay within project.')
      return
    }

    try {
      const result = await client.getFileContent(filePath)
      const content = result.content || ''

      if (!content) {
        await ctx.reply(`📄 File is empty: \`${escapeMarkdown(filePath)}\``, { parse_mode: 'Markdown' })
        return
      }

      const maxChunk = 4000
      if (content.length <= maxChunk) {
        await ctx.reply(`📄 *${escapeMarkdown(filePath)}*\n\n\`\`\`\n${content}\n\`\`\``, {
          parse_mode: 'Markdown',
        })
      } else {
        await ctx.reply(`📄 *${escapeMarkdown(filePath)}* (${content.length} chars)`, {
          parse_mode: 'Markdown',
        })

        for (let i = 0; i < content.length; i += maxChunk) {
          const chunk = content.substring(i, i + maxChunk)
          await ctx.reply(`\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'Markdown' })
        }
      }
    } catch (error) {
      await ctx.reply(`Failed to read file: ${(error as Error).message}`)
    }
  })

  // Find command
  bot.command('find', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const pattern = (ctx.match as string || '').trim()

    log.info('User command', { command: '/find', args: pattern, userId: ctx.from?.id })

    if (!pattern) {
      await ctx.reply('Usage: `/find <pattern>`\nExample: `/find function handleEvent`', { parse_mode: 'Markdown' })
      return
    }

    try {
      const results = await client.searchCode(pattern)

      if (!results || results.length === 0) {
        await ctx.reply(`🔍 No results for: \`${escapeMarkdown(pattern)}\``, { parse_mode: 'Markdown' })
        return
      }

      let message = `🔍 *Results for:* \`${escapeMarkdown(pattern)}\`\n\n`
      for (const result of results.slice(0, 20)) {
        const text = result.text?.trim().substring(0, 80) || ''
        message += `\`${escapeMarkdown(result.path)}:${result.line}\`\n${escapeMarkdown(text)}\n\n`
      }

      if (results.length > 20) {
        message += `_...and ${results.length - 20} more results_\n`
      }

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
      }
    } catch (error) {
      await ctx.reply(`Search failed: ${(error as Error).message}`)
    }
  })

  // Providers command
  bot.command('providers', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/providers', userId: ctx.from?.id })

    try {
      const providers = await client.listProviders()

      if (providers.length === 0) {
        await ctx.reply('No providers configured. Check your OpenCode settings.')
        return
      }

      let message = '*Available Providers:*\n\n'
      for (let i = 0; i < providers.length; i++) {
        const p = providers[i]
        const modelCount = Object.keys(p.models || {}).length
        message += `${i + 1}. \`${escapeMarkdown(p.id)}\` (${modelCount} models)\n`
      }
      message += '\nUse `/models <provider>` to see models for a provider.'

      await ctx.reply(message, { parse_mode: 'Markdown' })
    } catch (error) {
      await ctx.reply(`Failed to list providers: ${(error as Error).message}`)
    }
  })

  // Models command
  bot.command('models', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const providerFilter = (ctx.match as string || '').trim()

    log.info('User command', { command: '/models', args: providerFilter, userId: ctx.from?.id })

    if (!providerFilter) {
      await ctx.reply('Usage: `/models <provider>`\nExample: `/models anthropic`', { parse_mode: 'Markdown' })
      return
    }

    try {
      const models = await client.listModels(providerFilter)

      if (models.length === 0) {
        await ctx.reply(`No models found for provider: \`${escapeMarkdown(providerFilter)}\``, {
          parse_mode: 'Markdown',
        })
        return
      }

      let message = `*Models for* \`${escapeMarkdown(providerFilter)}\`:\n\n`
      for (let i = 0; i < models.length; i++) {
        message += `${i + 1}. \`${escapeMarkdown(models[i].id)}\``
        if (models[i].name && models[i].name !== models[i].id) {
          message += ` - ${escapeMarkdown(models[i].name)}`
        }
        message += '\n'
      }
      message += `\nSelect with: \`/model ${escapeMarkdown(providerFilter)} <model_id>\``

      const chunks = splitMessage(message)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
      }
    } catch (error) {
      await ctx.reply(`Failed to list models: ${(error as Error).message}`)
    }
  })

  // Model command
  bot.command('model', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const args = (ctx.match as string || '').trim()

    log.info('User command', { command: '/model', args, userId: ctx.from?.id })

    if (!args) {
      const currentModel = stateManager.getCurrentModel(ctx.chat.id)

      let message = ''
      if (currentModel) {
        message += `*Current Model:*\n\`${escapeMarkdown(currentModel.providerId)}/${escapeMarkdown(currentModel.modelId)}\`\n\n`
      } else {
        message += '*No model selected.* Using default.\n\n'
      }

      message += '*Usage:*\n'
      message += '• `/providers` - List providers\n'
      message += '• `/models <provider>` - List models for provider\n'
      message += '• `/model <provider> <model>` - Select model\n\n'
      message += 'Example:\n'
      message += '`/model anthropic claude-3-opus`'

      await ctx.reply(message, { parse_mode: 'Markdown' })
      return
    }

    const parts = args.split(/\s+/)
    if (parts.length < 2) {
      await ctx.reply(
        'Invalid format. Use:\n' +
        '`/model <provider> <model>`\n\n' +
        'Example:\n' +
        '`/model anthropic claude-3-opus`',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const providerId = parts[0]
    const modelId = parts.slice(1).join(' ')

    stateManager.setCurrentModel(ctx.chat.id, providerId, modelId)

    await ctx.reply(
      `✅ *Model selected:*\n\`${escapeMarkdown(providerId)}/${escapeMarkdown(modelId)}\``,
      { parse_mode: 'Markdown' }
    )
  })

  // Mode command
  bot.command('mode', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    const args = (ctx.match as string || '').trim().toLowerCase()

    log.info('User command', { command: '/mode', args, userId: ctx.from?.id })

    if (!args) {
      const currentMode = stateManager.getCurrentMode(ctx.chat.id)

      let message = ''
      if (currentMode) {
        message += `*Current Mode:* \`${escapeMarkdown(currentMode)}\`\n\n`
      } else {
        message += '*No mode selected.* Using default.\n\n'
      }

      message += '*Usage:* `/mode <name>`\n\n'
      message += 'Common modes:\n'
      message += '• `build` - Code implementation\n'
      message += '• `plan` - Planning and design'

      await ctx.reply(message, { parse_mode: 'Markdown' })
      return
    }

    stateManager.setCurrentMode(ctx.chat.id, args)

    await ctx.reply(
      `✅ *Mode selected:* \`${escapeMarkdown(args)}\``,
      { parse_mode: 'Markdown' }
    )
  })

  // Help command
  bot.command('help', async (ctx) => {
    if (!isAuthorized(ctx.from?.id.toString())) {
      await ctx.reply('You are not authorized to use this bot.')
      return
    }

    log.info('User command', { command: '/help', userId: ctx.from?.id })

    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' })
  })
}
