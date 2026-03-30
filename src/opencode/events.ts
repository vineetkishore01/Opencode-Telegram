import { Bot } from 'grammy'
import { OpenCodeClient } from './client.js'
import { StateManager } from '../state/manager.js'
import { PermissionHandler } from './permission.js'
import { MessageQueue } from '../bot/queue.js'
import { escapeMarkdown, splitMessage, stripAnsi, getFileIcon } from '../utils/formatter.js'
import { getLogger } from '../utils/logger.js'

export class EventProcessor {
  private running = false
  private workingSessions = new Map<string, { chatId: number; messageId: number }>()
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private consecutiveErrors = 0
  private maxConsecutiveErrors = 10

  constructor(
    private client: OpenCodeClient,
    private bot: Bot,
    private stateManager: StateManager,
    private permissionHandler: PermissionHandler,
    private messageQueue: MessageQueue
  ) {}

  private processedPartIds = new Set<string>()
  private isPolling = false

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const log = getLogger()
    log.info('Event processor started (Polling mode)')

    // Initial delay to let server fully settle
    console.log('⏳ Waiting 10s for OpenCode server to initialize...')
    await new Promise(resolve => setTimeout(resolve, 10000))
    console.log('✅ Initialization wait complete.')

    while (this.running) {
      if (this.isPolling) {
        await new Promise(resolve => setTimeout(resolve, 500))
        continue
      }

      this.isPolling = true
      try {
        // 1. Check for pending permissions
        await this.permissionHandler.checkPendingPermissions().catch(() => {})

        // 2. Poll active sessions for new message parts and status
        const chatIds = this.stateManager.getAllChatIds()
        for (const chatId of chatIds) {
          if (!this.running) break
          const sessionId = this.stateManager.getCurrentSession(chatId)
          if (!sessionId) continue

          try {
            // Fetch session info to check status
            const session = await this.client.getSession(sessionId)
            
            // Check status: if we were busy and now it's idle, trigger idle handler
            if (this.messageQueue.isBusy(chatId) && (session as any).status?.type === 'idle') {
              log.info('Task finished, session became idle', { sessionId, chatId })
              await this.handleSessionIdle({ sessionID: sessionId })
            }

            // Fetch last few messages to see if there are updates
            const messages = await this.client.getMessages(sessionId, 3)
            
            // Iterate through messages and their parts
            for (const msg of messages) {
              if (msg.parts) {
                for (const part of msg.parts) {
                  // Use a more robust key: sessionId + messageId + partId + type
                  const partKey = `${sessionId}:${msg.id}:${part.id || 'no-id'}:${part.type}`
                  
                  if (!this.processedPartIds.has(partKey)) {
                    log.debug('New message part detected', { partKey, type: part.type })
                    // New part found! Process it as an event
                    await this.handleMessagePartUpdated({ part })
                    this.processedPartIds.add(partKey)
                  }
                }
              }
            }

            // Periodically clean up processedPartIds to prevent memory leak
            if (this.processedPartIds.size > 1000) {
              const items = Array.from(this.processedPartIds)
              for (const item of items.slice(0, 500)) {
                this.processedPartIds.delete(item)
              }
            }

          } catch (e) {
            // Silent poll errors
          }
        }

        // Wait 2 seconds between polls
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) {
        log.error('Polling error', { error: (error as Error).message })
        await new Promise(resolve => setTimeout(resolve, 5000))
      } finally {
        this.isPolling = false
      }
    }
  }

  stop(): void {
    this.running = false
  }

  setWorkingMessage(sessionId: string, chatId: number, messageId: number): void {
    this.workingSessions.set(sessionId, { chatId, messageId })
  }

  private async handleEvent(event: any): Promise<void> {
    switch (event.type) {
      case 'permission.asked':
        await this.permissionHandler.handlePermissionRequest(event.properties)
        break

      case 'message.part.updated':
        await this.handleMessagePartUpdated(event.properties)
        break

      case 'file.edited':
        await this.handleFileEdited(event.properties)
        break

      case 'session.idle':
        await this.handleSessionIdle(event.properties)
        break

      case 'session.error':
        await this.handleSessionError(event.properties)
        break

      case 'session.status':
        await this.handleSessionStatus(event.properties)
        break

      case 'session.diff':
        await this.handleSessionDiff(event.properties)
        break

      case 'session.updated':
        await this.handleSessionUpdated(event.properties)
        break

      case 'session.compacted':
        await this.handleSessionCompacted(event.properties)
        break

      case 'question.asked':
        await this.handleQuestionAsked(event.properties)
        break

      case 'todo.updated':
        await this.handleTodoUpdated(event.properties)
        break

      case 'installation.update-available':
        await this.handleUpdateAvailable(event.properties)
        break

      case 'server.connected':
        getLogger().info('Connected to OpenCode')
        break
    }
  }

  private async handleMessagePartUpdated(event: any): Promise<void> {
    const part = event.part
    if (!part) return

    const log = getLogger()
    const chatId = this.stateManager.getChatIdForSession(part.sessionID)
    if (!chatId) {
      log.debug('Part received for session not owned by bot', { sessionID: part.sessionID })
      return
    }

    log.debug('Processing message part', { type: part.type, sessionID: part.sessionID })

    if (part.type === 'reasoning' && part.time?.end && part.text?.trim()) {
      const thinking = part.text.trim()
      if (thinking) {
        log.debug('Sending reasoning to Telegram', { length: thinking.length })
        const maxLen = 2000
        const displayText = thinking.length > maxLen
          ? thinking.substring(0, maxLen) + '...'
          : thinking

        await this.bot.api.sendMessage(
          chatId,
          `🤔 *Thinking:*\n${escapeMarkdown(displayText)}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {})
      }
    }

    if (part.type === 'tool') {
      await this.handleToolPart(chatId, part)
    }

    if (part.type === 'text' && part.time?.end && part.text?.trim()) {
      if (part.ignored || part.synthetic) {
        log.debug('Ignoring synthetic or ignored text part', { partID: part.id })
        return
      }

      const text = stripAnsi(part.text.trim())
      if (text) {
        log.debug('Sending response text to Telegram', { length: text.length })
        const chunks = splitMessage(`📝 *Response:*\n${escapeMarkdown(text)}`)
        for (const chunk of chunks) {
          await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() => {})
        }
      }
    }

    if (part.type === 'file') {
      await this.handleFilePart(chatId, part)
    }

    if (part.type === 'step-finish') {
      await this.handleStepFinish(chatId, part)
    }

    if (part.type === 'retry') {
      const attempt = part.attempt || '?'
      const error = stripAnsi(part.error?.message || 'Unknown error')
      const statusCode = part.error?.statusCode
      let retryMsg = `🔄 *Retry ${attempt}*`
      if (statusCode) retryMsg += ` [${statusCode}]`
      retryMsg += `: ${escapeMarkdown(error.substring(0, 150))}`
      await this.bot.api.sendMessage(chatId, retryMsg, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'subtask') {
      const desc = part.description || part.prompt?.substring(0, 100) || 'subtask'
      const agent = part.agent ? ` (${escapeMarkdown(part.agent)})` : ''
      await this.bot.api.sendMessage(
        chatId,
        `📋 *Subtask*${agent}: ${escapeMarkdown(desc)}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }

    if (part.type === 'agent') {
      const name = part.name || 'agent'
      await this.bot.api.sendMessage(
        chatId,
        `🤖 Agent: \`${escapeMarkdown(name)}\``,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }

    if (part.type === 'compaction') {
      const reason = part.overflow ? 'context overflow' : 'auto'
      await this.bot.api.sendMessage(
        chatId,
        `📦 *Context compacted* (${reason})`,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }

    if (part.type === 'patch') {
      const files = part.state?.files || []
      if (files.length > 0) {
        const fileList = files.slice(0, 5).map((f: string) => `\`${escapeMarkdown(f)}\``).join(', ')
        const more = files.length > 5 ? ` +${files.length - 5} more` : ''
        await this.bot.api.sendMessage(
          chatId,
          `📝 Patch: ${fileList}${more}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {})
      }
    }
  }

  private async handleToolPart(chatId: number, part: any): Promise<void> {
    const toolName = part.tool || 'unknown'
    const icon = this.getToolIcon(toolName)
    const formattedName = this.formatToolName(toolName)

    if (part.state?.status === 'running') {
      const title = stripAnsi(part.state?.title || '')
      if (title) {
        await this.bot.api.sendMessage(
          chatId,
          `⏳ ${icon} ${formattedName}: ${escapeMarkdown(title.substring(0, 100))}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {})
      }
    } else if (part.state?.status === 'completed') {
      const title = stripAnsi(part.state?.title || '')
      const output = part.state?.output?.substring(0, 300) || ''

      let message = `${icon} ${formattedName}`
      if (title) message += `: ${escapeMarkdown(title)}`

      if (toolName === 'bash' && output) {
        const cleanOutput = stripAnsi(output).trim()
        if (cleanOutput) {
          message += `\n\`\`\`\n${cleanOutput.substring(0, 200)}\n\`\`\``
        }
      }

      await this.bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {})
    } else if (part.state?.status === 'error') {
      const error = stripAnsi(part.state?.error || 'Unknown error')
      await this.bot.api.sendMessage(
        chatId,
        `❌ ${formattedName} failed: ${escapeMarkdown(error.substring(0, 200))}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }
  }

  private async handleFilePart(chatId: number, part: any): Promise<void> {
    const filename = part.filename || part.source?.path || 'file'
    const icon = getFileIcon(filename)

    let message = `${icon} \`${escapeMarkdown(filename)}\``
    if (part.source?.text?.value) {
      const snippet = part.source.text.value.substring(0, 150).trim()
      if (snippet) {
        message += `\n\`\`\`\n${snippet}\n\`\`\``
      }
    }

    await this.bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {})
  }

  private async handleStepFinish(chatId: number, part: any): Promise<void> {
    const tokens = part.tokens
    const cost = part.cost

    if (tokens || cost) {
      let info = '📊 '
      if (tokens) {
        info += `${tokens.input || 0}→${tokens.output || 0} tokens`
        if (tokens.reasoning && tokens.reasoning > 0) {
          info += ` (${tokens.reasoning} reasoning)`
        }
        if (tokens.cache?.read > 0 || tokens.cache?.write > 0) {
          info += ` [cache: ${tokens.cache.read}r/${tokens.cache.write}w]`
        }
      }
      if (cost && cost > 0) {
        info += ` • $${cost.toFixed(4)}`
      }

      const sessionId = part.sessionID
      if (sessionId) {
        this.stateManager.addCost(
          sessionId,
          cost || 0,
          tokens?.input || 0,
          tokens?.output || 0,
          tokens?.reasoning || 0,
          tokens?.cache?.read || 0,
          tokens?.cache?.write || 0
        )
      }

      await this.bot.api.sendMessage(chatId, info).catch(() => {})
    }
  }

  private async handleFileEdited(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const filePath = event.path || event.file || 'unknown file'
    const icon = getFileIcon(filePath)
    await this.bot.api.sendMessage(
      chatId,
      `${icon} Edited: \`${escapeMarkdown(filePath)}\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {})
  }

  private async handleSessionError(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const errorName = event.error?.name || 'Error'
    const errorMsg = stripAnsi(event.error?.message || 'Unknown error')

    await this.bot.api.sendMessage(
      chatId,
      `⚠️ *${escapeMarkdown(errorName)}*\n${escapeMarkdown(errorMsg.substring(0, 300))}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {})
  }

  private async handleSessionStatus(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const status = event.status
    if (!status) return

    if (status.type === 'busy') {
      this.messageQueue.setBusy(chatId)
    } else if (status.type === 'idle') {
      this.messageQueue.setIdle(chatId)
    } else if (status.type === 'retry') {
      const attempt = status.attempt || '?'
      const message = status.message || 'Retrying...'
      const nextSecs = status.next ? ` (next in ${Math.round(status.next / 1000)}s)` : ''
      await this.bot.api.sendMessage(
        chatId,
        `🔄 *Retry ${attempt}*${nextSecs}: ${escapeMarkdown(message.substring(0, 150))}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }
  }

  private async handleSessionDiff(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const diffs = event.diff || []
    if (diffs.length === 0) return

    let message = `📁 *File Changes (${diffs.length}):*\n\n`
    for (const diff of diffs.slice(0, 10)) {
      const statusIcon = diff.status === 'added' ? '🆕' : diff.status === 'deleted' ? '🗑️' : '📝'
      message += `${statusIcon} \`${escapeMarkdown(diff.file)}\` (+${diff.additions || 0} -${diff.deletions || 0})\n`
    }
    if (diffs.length > 10) {
      message += `_...and ${diffs.length - 10} more files_\n`
    }

    const chunks = splitMessage(message)
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() => {})
    }
  }

  private async handleSessionUpdated(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const info = event.info
    if (!info) return

    if (info.title) {
      await this.bot.api.sendMessage(
        chatId,
        `📝 *Session title:* ${escapeMarkdown(info.title)}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }

    if (info.summary) {
      const s = info.summary
      if (s.additions || s.deletions) {
        await this.bot.api.sendMessage(
          chatId,
          `📊 Changes: +${s.additions || 0} -${s.deletions || 0} (${s.files || 0} files)`,
          { parse_mode: 'Markdown' }
        ).catch(() => {})
      }
    }
  }

  private async handleSessionCompacted(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    await this.bot.api.sendMessage(
      chatId,
      '📦 *Context compacted* — older messages summarized to save space.',
      { parse_mode: 'Markdown' }
    ).catch(() => {})
  }

  private async handleQuestionAsked(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const log = getLogger()
    log.info('Question asked', { questionId: event.id, sessionID: event.sessionID })

    const questionText = event.question || 'OpenCode has a question'
    const options: string[] = event.options || []
    const header = event.header || 'Question'

    let message = `❓ *${escapeMarkdown(header)}*\n\n${escapeMarkdown(questionText)}`

    if (options.length > 0) {
      const inlineKeyboard = options.map((opt, idx) => [{
        text: opt,
        callback_data: `q:${event.id}:${idx}`,
      }])

      inlineKeyboard.push([{
        text: '❌ Dismiss',
        callback_data: `q:reject:${event.id}`,
      }])

      await this.bot.api.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      }).catch(error => {
        log.error('Failed to send question', { error: (error as Error).message })
      })
    } else {
      message += '\n\n_Reply to this message with your answer._'
      await this.bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(error => {
        log.error('Failed to send question', { error: (error as Error).message })
      })
    }
  }

  private async handleTodoUpdated(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const todos: Array<{ content: string; status: string; priority: string }> = event.todos || []
    if (todos.length === 0) return

    const statusIcon: Record<string, string> = {
      completed: '✅', in_progress: '🔄', pending: '⬜', cancelled: '❌',
    }

    let message = `📋 *Todo List:*\n\n`
    for (const todo of todos.slice(0, 15)) {
      const icon = statusIcon[todo.status] || '⬜'
      const content = todo.content?.substring(0, 60) || ''
      message += `${icon} ${escapeMarkdown(content)}\n`
    }

    await this.bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {})
  }

  private async handleUpdateAvailable(event: any): Promise<void> {
    const chatIds = this.stateManager.getAllChatIds()
    for (const chatId of chatIds) {
      await this.bot.api.sendMessage(
        chatId,
        `🔔 *Update Available*: OpenCode \`${escapeMarkdown(event.version || 'new version')}\` is available!`,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }
  }

  private async handleSessionIdle(event: any): Promise<void> {
    const sessionID = event.sessionID
    const chatId = this.stateManager.getChatIdForSession(sessionID)
    if (!chatId) return

    const working = this.workingSessions.get(sessionID)
    if (working) {
      await this.bot.api.editMessageText(
        working.chatId,
        working.messageId,
        '✅ Task completed!'
      ).catch(() => {})
      this.workingSessions.delete(sessionID)
    }

    this.messageQueue.setIdle(chatId)

    const next = this.messageQueue.dequeue(chatId)
    if (next) {
      this.messageQueue.setBusy(chatId)
      const selectedModel = this.stateManager.getCurrentModel(chatId)
      const selectedMode = this.stateManager.getCurrentMode(chatId)

      try {
        const workingMsg = await this.bot.api.sendMessage(chatId, '⏳ Processing next message...')
        this.setWorkingMessage(sessionID, chatId, workingMsg.message_id)

        await this.client.sendAsyncMessage(sessionID, next.text, {
          providerId: selectedModel?.providerId,
          modelId: selectedModel?.modelId,
          agent: selectedMode,
        })
        next.resolve()
      } catch (error) {
        getLogger().error('Failed to process queued message', { error: (error as Error).message })
        await this.bot.api.sendMessage(chatId, `❌ Error: ${(error as Error).message}`).catch(() => {})
        next.reject(error as Error)
      }
    } else {
      await this.bot.api.sendMessage(chatId, '✅ *Done!*', { parse_mode: 'Markdown' }).catch(() => {})
    }
  }

  private getToolIcon(tool: string): string {
    const icons: Record<string, string> = {
      bash: '🖥️', edit: '✏️', write: '📝', read: '📖',
      grep: '🔍', glob: '🔍', todowrite: '📋', websearch: '🌐',
    }
    return icons[tool] || '🔧'
  }

  private formatToolName(tool: string): string {
    const toolNames: Record<string, string> = {
      bash: 'Bash', edit: 'Edit', write: 'Write', read: 'Read',
      grep: 'Grep', glob: 'Glob', todowrite: 'Todo', websearch: 'Search',
    }
    return toolNames[tool] || tool.charAt(0).toUpperCase() + tool.slice(1)
  }
}
