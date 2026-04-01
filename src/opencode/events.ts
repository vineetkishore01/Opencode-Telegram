import { Bot } from 'grammy'
import { OpenCodeClient } from './client.js'
import { StateManager } from '../state/manager.js'
import { PermissionHandler } from './permission.js'
import { MessageQueue } from '../bot/queue.js'
import { escapeMarkdown, splitMessage, stripAnsi } from '../utils/formatter.js'
import { getLogger } from '../utils/logger.js'

interface BusySessionInfo {
  chatId: number
  sessionId: string
  lastMessageCount: number
  lastProcessedMessageId?: string
  processedStepFinishIds: Set<string>
  startedAt: number
  lastActivityAt: number
  idleProcessing: boolean
  lastTodoHash: string
  lastWorkingStatus: string
  lastToolCall: string
  stepStartSeen: boolean
  currentStepTitle: string
}

interface TodoItem {
  content: string
  status: string
  priority: string
}

export class EventProcessor {
  private running = false
  private workingSessions = new Map<string, { chatId: number; messageId: number; statusMessageId?: number }>()
  private consecutiveErrors = 0
  private maxConsecutiveErrors = 10
  private busySessions = new Map<string, BusySessionInfo>()
  private readonly SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000
  private readonly POLL_INTERVAL_MS = 3000
  private readonly TODO_POLL_INTERVAL_MS = 10000
  private readonly WORKING_STATUS_INTERVAL_MS = 15000

  constructor(
    private client: OpenCodeClient,
    private bot: Bot,
    private stateManager: StateManager,
    private permissionHandler: PermissionHandler,
    private messageQueue: MessageQueue
  ) {}

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const log = getLogger()
    log.info('Event processor started (Polling mode)')

    let todoPollCounter = 0
    let statusPollCounter = 0

    while (this.running) {
      try {
        await this.permissionHandler.checkPendingPermissions().catch(() => {})

        const chatIds = this.stateManager.getAllChatIds()
        for (const chatId of chatIds) {
          const sessionId = this.stateManager.getCurrentSession(chatId)
          if (!sessionId) continue

          const isBusy = this.messageQueue.isBusy(chatId)

          if (isBusy && !this.busySessions.has(sessionId)) {
            try {
              const messages = await this.client.getMessages(sessionId, 5)
              const todos = await this.client.getSessionTodo(sessionId).catch(() => [])
              this.busySessions.set(sessionId, {
                chatId,
                sessionId,
                lastMessageCount: messages.length,
                processedStepFinishIds: new Set(),
                startedAt: Date.now(),
                lastActivityAt: Date.now(),
                idleProcessing: false,
                lastTodoHash: this.hashTodos(todos),
                lastWorkingStatus: '',
                lastToolCall: '',
                stepStartSeen: false,
                currentStepTitle: '',
              })
            } catch {
              // Ignore - will retry next poll
            }
          } else if (!isBusy) {
            this.busySessions.delete(sessionId)
          }
        }

        todoPollCounter++
        statusPollCounter++

        const sessionsToProcess = [...this.busySessions.entries()]
        for (const [sessionId, busyInfo] of sessionsToProcess) {
          try {
            const messages = await this.client.getMessages(sessionId, 5)

            busyInfo.lastActivityAt = Date.now()

            const latestAssistant = messages
              .filter(m => m.role === 'assistant')
              .pop()

            if (latestAssistant && latestAssistant.time?.completed) {
              log.info('Detected session completion via polling', { sessionId, chatId: busyInfo.chatId })
              this.busySessions.delete(sessionId)
              await this.processSessionIdle(sessionId, busyInfo.chatId)
            } else {
              if (messages.length !== busyInfo.lastMessageCount) {
                busyInfo.lastMessageCount = messages.length
                await this.processNewMessages(busyInfo.chatId, sessionId, messages, busyInfo)
              }

              if (todoPollCounter >= Math.floor(this.TODO_POLL_INTERVAL_MS / this.POLL_INTERVAL_MS)) {
                await this.pollTodos(busyInfo)
              }

              if (statusPollCounter >= Math.floor(this.WORKING_STATUS_INTERVAL_MS / this.POLL_INTERVAL_MS)) {
                await this.pollWorkingStatus(busyInfo)
              }
            }
          } catch (error) {
            log.warn('Failed to poll busy session', { sessionId, error: (error as Error).message })
            this.busySessions.delete(sessionId)
            this.messageQueue.setIdle(busyInfo.chatId)

            const working = this.workingSessions.get(sessionId)
            if (working) {
              await this.bot.api.editMessageText(
                working.chatId,
                working.messageId,
                '❌ Connection to OpenCode lost'
              ).catch(() => {})
              this.workingSessions.delete(sessionId)
            }
          }
        }

        if (todoPollCounter >= Math.floor(this.TODO_POLL_INTERVAL_MS / this.POLL_INTERVAL_MS)) {
          todoPollCounter = 0
        }
        if (statusPollCounter >= Math.floor(this.WORKING_STATUS_INTERVAL_MS / this.POLL_INTERVAL_MS)) {
          statusPollCounter = 0
        }

        for (const [sessionId, busyInfo] of [...this.busySessions.entries()]) {
          if (!this.messageQueue.isBusy(busyInfo.chatId)) {
            this.busySessions.delete(sessionId)
          }
        }

        for (const [sessionId, busyInfo] of [...this.busySessions.entries()]) {
          const age = Date.now() - busyInfo.startedAt
          const inactive = Date.now() - busyInfo.lastActivityAt
          if (age > this.SESSION_TIMEOUT_MS || inactive > this.SESSION_TIMEOUT_MS) {
            log.warn('Session timed out, forcing idle', { sessionId, age, inactive })
            this.busySessions.delete(sessionId)
            this.messageQueue.setIdle(busyInfo.chatId)

            const working = this.workingSessions.get(sessionId)
            if (working) {
              await this.bot.api.editMessageText(
                working.chatId,
                working.messageId,
                '⏰ Session timed out (4 hour limit)'
              ).catch(() => {})
              this.workingSessions.delete(sessionId)
            }

            await this.processSessionIdle(sessionId, busyInfo.chatId)
          }
        }

        for (const chatId of chatIds) {
          this.messageQueue.purgeStale(chatId)
        }

        this.consecutiveErrors = 0
        await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL_MS))
      } catch (error) {
        this.consecutiveErrors++
        log.error('Polling error', { error: (error as Error).message, consecutiveErrors: this.consecutiveErrors })

        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          log.error('Too many consecutive errors, stopping event processor')
          this.running = false
          break
        }

        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  private async pollTodos(busyInfo: BusySessionInfo): Promise<void> {
    try {
      const todos = await this.client.getSessionTodo(busyInfo.sessionId)
      const currentHash = this.hashTodos(todos)

      if (currentHash !== busyInfo.lastTodoHash && todos.length > 0) {
        busyInfo.lastTodoHash = currentHash
        await this.sendTodoUpdate(busyInfo.chatId, todos)
      }
    } catch {
      // Ignore todo poll errors
    }
  }

  private async pollWorkingStatus(busyInfo: BusySessionInfo): Promise<void> {
    try {
      const messages = await this.client.getMessages(busyInfo.sessionId, 3)
      const latest = messages[messages.length - 1]
      if (!latest || latest.role !== 'assistant' || !latest.parts) return

      const activeTools: Array<{ tool: string; title: string }> = []
      let currentStep = ''

      for (const part of latest.parts) {
        if (part.type === 'step-start') {
          currentStep = (part as any).title || (part as any).label || ''
        }
        if (part.type === 'tool' && part.state?.status === 'running') {
          activeTools.push({
            tool: part.tool || 'unknown',
            title: stripAnsi(part.state?.title || ''),
          })
        }
      }

      const statusText = this.buildWorkingStatus(currentStep, activeTools)
      if (statusText && statusText !== busyInfo.lastWorkingStatus) {
        busyInfo.lastWorkingStatus = statusText
        busyInfo.currentStepTitle = currentStep

        const working = this.workingSessions.get(busyInfo.sessionId)
        if (working?.statusMessageId) {
          await this.bot.api.editMessageText(
            working.chatId,
            working.statusMessageId,
            statusText,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      }
    } catch {
      // Ignore working status poll errors
    }
  }

  private buildWorkingStatus(step: string, tools: Array<{ tool: string; title: string }>): string {
    const parts: string[] = []

    if (step) {
      parts.push(`🚀 *Step:* ${escapeMarkdown(step)}`)
    }

    for (const t of tools.slice(0, 3)) {
      const icon = this.getToolIcon(t.tool)
      const name = this.formatToolName(t.tool)
      if (t.title) {
        parts.push(`${icon} *${name}:* ${escapeMarkdown(t.title.substring(0, 80))}`)
      } else {
        parts.push(`${icon} *${name}*`)
      }
    }

    if (parts.length === 0) return ''

    return `🔧 *Working...*\n\n${parts.join('\n')}`
  }

  private async sendTodoUpdate(chatId: number, todos: TodoItem[]): Promise<void> {
    const statusIcon: Record<string, string> = {
      completed: '✅', in_progress: '🔄', pending: '⬜', cancelled: '❌',
    }

    const pendingTodos = todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
    if (pendingTodos.length === 0) return

    let message = `📋 *Todo List (${pendingTodos.length} remaining):*\n\n`
    for (const todo of todos.slice(0, 15)) {
      const icon = statusIcon[todo.status] || '⬜'
      const content = todo.content?.substring(0, 80) || ''
      message += `${icon} ${escapeMarkdown(content)}\n`
    }

    await this.sendWithRateLimit(chatId, message, { parse_mode: 'Markdown' })
  }

  private hashTodos(todos: TodoItem[]): string {
    return todos.map(t => `${t.status}:${t.content}`).join('|')
  }

  private async processSessionIdle(sessionId: string, chatId: number): Promise<void> {
    const existingBusy = this.busySessions.get(sessionId)
    if (existingBusy?.idleProcessing) return
    if (existingBusy) {
      existingBusy.idleProcessing = true
    }

    const working = this.workingSessions.get(sessionId)
    if (working) {
      await this.bot.api.editMessageText(
        working.chatId,
        working.messageId,
        '✅ Task completed!'
      ).catch(() => {})
      if (working.statusMessageId) {
        await this.bot.api.deleteMessage(working.chatId, working.statusMessageId).catch(() => {})
      }
      this.workingSessions.delete(sessionId)
    }

    this.messageQueue.setIdle(chatId)

    const next = this.messageQueue.dequeue(chatId)
    if (next) {
      this.messageQueue.setBusy(chatId)
      const selectedModel = this.stateManager.getCurrentModel(chatId)
      const selectedMode = this.stateManager.getCurrentMode(chatId)

      try {
        const workingMsg = await this.bot.api.sendMessage(chatId, '⏳ Processing next message...')
        this.setWorkingMessage(sessionId, chatId, workingMsg.message_id)

        await this.client.sendAsyncMessage(sessionId, next.text, {
          providerId: selectedModel?.providerId,
          modelId: selectedModel?.modelId,
          agent: selectedMode,
        })
        next.resolve()
      } catch (error) {
        getLogger().error('Failed to process queued message', { error: (error as Error).message })
        await this.bot.api.sendMessage(chatId, `❌ Error: ${(error as Error).message}`).catch(() => {})
        next.reject(error as Error)
        this.messageQueue.setIdle(chatId)
      }
    } else {
      await this.bot.api.sendMessage(chatId, '✅ *Done!*', { parse_mode: 'Markdown' }).catch(() => {})
    }
  }

  private async processNewMessages(chatId: number, sessionId: string, messages: any[], busyInfo: BusySessionInfo): Promise<void> {
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.parts) continue
      if (busyInfo.lastProcessedMessageId && msg.id === busyInfo.lastProcessedMessageId) continue

      for (const part of msg.parts) {
        if (part.type === 'step-start') {
          const stepTitle = (part as any).title || (part as any).label || ''
          if (stepTitle && stepTitle !== busyInfo.currentStepTitle) {
            busyInfo.currentStepTitle = stepTitle
            busyInfo.stepStartSeen = true
            await this.sendWithRateLimit(
              chatId,
              `🚀 *Step started:* ${escapeMarkdown(stepTitle)}`,
              { parse_mode: 'Markdown' }
            )
          }
        }

        if (part.type === 'reasoning' && part.time?.end && part.text?.trim()) {
          const thinking = part.text.trim()
          const maxLen = 2000
          const displayText = thinking.length > maxLen ? thinking.substring(0, maxLen) + '...' : thinking
          await this.sendWithRateLimit(
            chatId,
            `🤔 *Thinking:*\n${escapeMarkdown(displayText)}`,
            { parse_mode: 'Markdown' }
          )
        }

        if (part.type === 'text' && part.time?.end && part.text?.trim()) {
          if (part.ignored || part.synthetic) continue
          const text = stripAnsi(part.text.trim())
          if (text) {
            const chunks = splitMessage(`📝 *Response:*\n${escapeMarkdown(text)}`)
            for (const chunk of chunks) {
              await this.sendWithRateLimit(chatId, chunk, { parse_mode: 'Markdown' })
            }
          }
        }

        if (part.type === 'tool' && part.state?.status === 'running') {
          const toolName = part.tool || 'unknown'
          const icon = this.getToolIcon(toolName)
          const title = stripAnsi(part.state?.title || '')
          const toolKey = `${toolName}:${title}`
          if (title && toolKey !== busyInfo.lastToolCall) {
            busyInfo.lastToolCall = toolKey
            await this.sendWithRateLimit(
              chatId,
              `⏳ ${icon} *${this.formatToolName(toolName)}:* ${escapeMarkdown(title.substring(0, 100))}`,
              { parse_mode: 'Markdown' }
            )
          }
        }

        if (part.type === 'step-finish') {
          const stepId = part.id || `${msg.id}-${part.type}`
          if (busyInfo.processedStepFinishIds.has(stepId)) continue
          busyInfo.processedStepFinishIds.add(stepId)

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
            this.stateManager.addCost(
              sessionId,
              cost || 0,
              tokens?.input || 0,
              tokens?.output || 0,
              tokens?.reasoning || 0,
              tokens?.cache?.read || 0,
              tokens?.cache?.write || 0
            )
            await this.sendWithRateLimit(chatId, info)
          }
        }
      }

      busyInfo.lastProcessedMessageId = msg.id
    }
  }

  private async sendWithRateLimit(chatId: number, text: string, options?: any): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatId, text, options)
    } catch (error: any) {
      if (error.description?.includes('rate limit') || error.error_code === 429) {
        const retryAfter = error.parameters?.retry_after || 1
        getLogger().warn('Telegram rate limited, waiting', { retryAfter })
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
        try {
          await this.bot.api.sendMessage(chatId, text, options)
        } catch {
          // Give up on this message
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }

  setWorkingMessage(sessionId: string, chatId: number, messageId: number): void {
    this.workingSessions.set(sessionId, { chatId, messageId })
  }

  getWorkingStatus(sessionId: string): string | null {
    const busyInfo = this.busySessions.get(sessionId)
    if (!busyInfo) return null

    const parts: string[] = []
    if (busyInfo.currentStepTitle) {
      parts.push(`Step: ${busyInfo.currentStepTitle}`)
    }

    const elapsed = Math.floor((Date.now() - busyInfo.startedAt) / 1000)
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    parts.push(`Running: ${mins}m ${secs}s`)

    return parts.join(' | ')
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
      await this.sendWithRateLimit(chatId, chunk, { parse_mode: 'Markdown' })
    }
  }

  private async handleSessionUpdated(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    const info = event.info
    if (!info) return

    if (info.title) {
      await this.sendWithRateLimit(
        chatId,
        `📝 *Session title:* ${escapeMarkdown(info.title)}`,
        { parse_mode: 'Markdown' }
      )
    }

    if (info.summary) {
      const s = info.summary
      if (s.additions || s.deletions) {
        await this.sendWithRateLimit(
          chatId,
          `📊 Changes: +${s.additions || 0} -${s.deletions || 0} (${s.files || 0} files)`,
          { parse_mode: 'Markdown' }
        )
      }
    }
  }

  private async handleSessionCompacted(event: any): Promise<void> {
    const chatId = this.stateManager.getChatIdForSession(event.sessionID)
    if (!chatId) return

    await this.sendWithRateLimit(
      chatId,
      '📦 *Context compacted* — older messages summarized to save space.',
      { parse_mode: 'Markdown' }
    )
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

    const todos: TodoItem[] = event.todos || []
    if (todos.length === 0) return

    await this.sendTodoUpdate(chatId, todos)
  }

  private async handleUpdateAvailable(event: any): Promise<void> {
    const chatIds = this.stateManager.getAllChatIds()
    for (const chatId of chatIds) {
      await this.sendWithRateLimit(
        chatId,
        `🔔 *Update Available*: OpenCode \`${escapeMarkdown(event.version || 'new version')}\` is available!`,
        { parse_mode: 'Markdown' }
      )
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
