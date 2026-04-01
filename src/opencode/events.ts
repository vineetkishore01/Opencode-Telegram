import { Bot } from 'grammy'
import { OpenCodeClient, OpenCodeEvent } from './client.js'
import { StateManager } from '../state/manager.js'
import { PermissionHandler } from './permission.js'
import { MessageQueue } from '../bot/queue.js'
import { escapeMarkdown, splitMessage, stripAnsi, getFileIcon } from '../utils/formatter.js'
import { getLogger } from '../utils/logger.js'

interface OutgoingMessage {
  chatId: number
  text: string
  options?: any
}

/**
 * EventProcessor - Handles OpenCode SSE events and relays them to Telegram
 * 
 * Architecture:
 * 1. Subscribes to OpenCode SSE event stream once on startup
 * 2. Events are pushed in real-time (no polling!)
 * 3. Each session tracks its own state independently
 * 4. Outgoing messages are queued and rate-limited per chat
 */
export class EventProcessor {
  private running = false
  private workingSessions = new Map<string, { chatId: number; messageId: number }>()
  private outgoingQueues = new Map<number, OutgoingMessage[]>()
  private queueProcessing = new Set<number>()

  // Session state tracking
  private sessionStates = new Map<string, {
    chatId: number
    isWorking: boolean
    currentStep?: string
  }>()

  private readonly RATE_LIMIT_DELAY_MS = 500

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
    log.info('Event processor started (SSE mode)')

    try {
      // Subscribe to SSE event stream
      await this.client.subscribeEvents((event) => {
        this.handleEvent(event).catch(err => {
          log.error('Event handler failed', { error: (err as Error).message })
        })
      })
    } catch (error) {
      log.error('Failed to start event processor', { error: (error as Error).message })
      this.running = false
      throw error
    }
  }

  private async handleEvent(event: OpenCodeEvent): Promise<void> {
    const log = getLogger()
    const sessionId = event.sessionId

    if (!sessionId) {
      log.debug('Event without session', { type: event.type })
      return
    }

    const state = this.sessionStates.get(sessionId)
    if (!state) {
      log.debug('Event for untracked session', { sessionId, type: event.type })
      return
    }

    log.debug('Received event', { sessionId, type: event.type })

    switch (event.type) {
      case 'session.created':
      case 'session.started':
        await this.handleSessionStarted(sessionId, state, event.data)
        break

      case 'message.created':
      case 'message.started':
        await this.handleMessageStarted(sessionId, state, event.data)
        break

      case 'message.part.created':
        await this.handleMessagePartCreated(sessionId, state, event.data)
        break

      case 'message.part.updated':
        await this.handleMessagePartUpdated(sessionId, state, event.data)
        break

      case 'message.completed':
        await this.handleMessageCompleted(sessionId, state, event.data)
        break

      case 'session.completed':
      case 'session.idle':
        await this.handleSessionIdle(sessionId, state, event.data)
        break

      case 'permission.requested':
        await this.handlePermissionRequested(sessionId, state, event.data)
        break

      case 'tool.started':
      case 'tool.completed':
        await this.handleToolEvent(sessionId, state, event.data)
        break

      case 'step.started':
        await this.handleStepStarted(sessionId, state, event.data)
        break

      case 'question.asked':
        await this.handleQuestionAsked(sessionId, state, event.data)
        break

      case 'session.error':
        await this.handleSessionError(sessionId, state, event.data)
        break

      case 'session.updated':
        await this.handleSessionUpdated(sessionId, state, event.data)
        break

      case 'todo.updated':
        await this.handleTodoUpdated(sessionId, state, event.data)
        break

      case 'message.removed':
      case 'message.part.removed':
        await this.handleMessageRemoved(sessionId, state, event.data)
        break

      case 'session.status':
        await this.handleSessionStatus(sessionId, state, event.data)
        break

      case 'error':
        await this.handleError(sessionId, state, event.data)
        break
    }
  }

  private async handleSessionStarted(sessionId: string, state: SessionState, data: any): Promise<void> {
    // Session started - ready to receive messages
    getLogger().debug('Session started', { sessionId })
  }

  private async handleMessageStarted(sessionId: string, state: SessionState, data: any): Promise<void> {
    // Mark session as working
    state.isWorking = true
    this.workingSessions.set(sessionId, { chatId: state.chatId, messageId: 0 })
  }

  private async handleMessagePartCreated(sessionId: string, state: SessionState, data: any): Promise<void> {
    const part = data.part || data
    const partType = part.type

    if (partType === 'text' || partType === 'reasoning') {
      const text = stripAnsi(part.text || '')
      if (!text.trim()) return

      const prefix = partType === 'reasoning' ? '🤔 *Thinking:*\n' : '📝 *Response:*\n'
      this.queueMessage(state.chatId, prefix + escapeMarkdown(text), { parse_mode: 'Markdown' })
    }

    if (partType === 'file') {
      await this.handleFilePart(state.chatId, part)
    }
  }

  private async handleMessagePartUpdated(sessionId: string, state: SessionState, data: any): Promise<void> {
    const part = data.part || data
    const partType = part.type

    if (partType === 'text' || partType === 'reasoning') {
      // For updates, we could send deltas, but for simplicity send full text
      const text = stripAnsi(part.text || '')
      if (!text.trim()) return

      // Only send if significantly different from last
      const prefix = partType === 'reasoning' ? '🤔 *Thinking:*\n' : '📝 *Response:*\n'
      this.queueMessage(state.chatId, prefix + escapeMarkdown(text.substring(0, 4000)), { parse_mode: 'Markdown' })
    }
  }

  private async handleMessageCompleted(sessionId: string, state: SessionState, data: any): Promise<void> {
    state.isWorking = false

    // Update working message to show completion
    const working = this.workingSessions.get(sessionId)
    if (working && working.messageId !== 0) {
      this.queueMessage(working.chatId, '✅ Task completed!', { editMessageId: working.messageId })
    } else {
      this.queueMessage(state.chatId, '✅ *Done!*', { parse_mode: 'Markdown' })
    }

    this.workingSessions.delete(sessionId)

    // Process next queued message
    await this.processNextQueuedMessage(sessionId, state.chatId)
  }

  private async handleSessionIdle(sessionId: string, state: SessionState, data: any): Promise<void> {
    state.isWorking = false
    this.workingSessions.delete(sessionId)
    this.messageQueue.setIdle(state.chatId)

    // Send completion notification if not already sent
    this.queueMessage(state.chatId, '✅ *Done!*', { parse_mode: 'Markdown' })

    // Process next queued message
    await this.processNextQueuedMessage(sessionId, state.chatId)
  }

  private async handlePermissionRequested(sessionId: string, state: SessionState, data: any): Promise<void> {
    const permission: any = {
      id: data.id || data.requestId,
      sessionID: sessionId,
      type: data.type,
      description: data.description,
      options: data.options,
      status: 'pending'
    }
    await this.permissionHandler.handlePermissionRequest(permission)
  }

  private async handleToolEvent(sessionId: string, state: SessionState, data: any): Promise<void> {
    const toolName = data.tool || 'unknown'
    const status = data.state?.status || data.status
    const icons: Record<string, string> = { bash: '🖥️', edit: '✏️', write: '📝', read: '📖', grep: '🔍', glob: '🔍', todowrite: '📋', websearch: '🌐' }
    const icon = icons[toolName] || '🔧'

    if (status === 'running') {
      const title = stripAnsi(data.state?.title || '').substring(0, 100)
      if (title) {
        this.queueMessage(state.chatId, `⏳ ${icon} *${title}*`, { parse_mode: 'Markdown' })
      }
    } else if (status === 'completed') {
      let msg = `${icon} ${toolName}`
      if (toolName === 'bash' && data.state?.output) {
        const out = stripAnsi(data.state.output).trim().substring(0, 200)
        if (out) msg += `\n\`\`\`\n${out}\n\`\`\``
      }
      this.queueMessage(state.chatId, msg, { parse_mode: 'Markdown' })
    }
  }

  private async handleStepStarted(sessionId: string, state: SessionState, data: any): Promise<void> {
    const title = data.title || data.stepName || 'Step started'
    state.currentStep = title
    this.queueMessage(state.chatId, `🚀 *${escapeMarkdown(title)}*`, { parse_mode: 'Markdown' })
  }

  private async handleQuestionAsked(sessionId: string, state: SessionState, data: any): Promise<void> {
    const questionId = data.id || data.questionId
    const question = data.question || data.text || 'Please answer this question'
    const options = data.options || []
    const header = data.header || 'Question'

    if (!questionId) {
      getLogger().warn('Question event without ID', { sessionId })
      return
    }

    // Build inline keyboard with options
    const inlineKeyboard: any = {
      inline_keyboard: []
    }

    if (options.length > 0) {
      // Add option buttons (max 4 per row as per Telegram limits)
      const buttonsPerRow = 4
      for (let i = 0; i < options.length; i += buttonsPerRow) {
        const row = []
        for (let j = i; j < Math.min(i + buttonsPerRow, options.length); j++) {
          row.push({
            text: options[j],
            callback_data: `q:${questionId}:${j}`
          })
        }
        inlineKeyboard.inline_keyboard.push(row)
      }
      // Add reject button
      inlineKeyboard.inline_keyboard.push([{
        text: '❌ Skip',
        callback_data: `q:${questionId}:reject`
      }])
    } else {
      // If no options, provide simple acknowledge buttons
      inlineKeyboard.inline_keyboard = [
        [
          { text: '✅ Yes', callback_data: `q:${questionId}:0` },
          { text: '❌ No', callback_data: `q:${questionId}:reject` }
        ]
      ]
    }

    const message = `❓ *${escapeMarkdown(header)}*\n\n${escapeMarkdown(question)}`
    this.queueMessage(state.chatId, message, { reply_markup: inlineKeyboard, parse_mode: 'Markdown' })
  }

  private async handleError(sessionId: string, state: SessionState, data: any): Promise<void> {
    const errorMsg = stripAnsi(data.message || data.error || 'Unknown error').substring(0, 500)
    this.queueMessage(state.chatId, `❌ *Error:* ${escapeMarkdown(errorMsg)}`, { parse_mode: 'Markdown' })

    state.isWorking = false
    this.workingSessions.delete(sessionId)
    this.messageQueue.setIdle(state.chatId)
  }

  private async handleSessionError(sessionId: string, state: SessionState, data: any): Promise<void> {
    const errorMsg = stripAnsi(data.message || data.error?.message || 'Session error').substring(0, 500)
    this.queueMessage(state.chatId, `❌ *Session Error:* ${escapeMarkdown(errorMsg)}`, { parse_mode: 'Markdown' })

    state.isWorking = false
    this.workingSessions.delete(sessionId)
    this.messageQueue.setIdle(state.chatId)
  }

  private async handleSessionUpdated(sessionId: string, state: SessionState, data: any): Promise<void> {
    // Session metadata updated (e.g., title change)
    const title = data.title || data.summary
    if (title) {
      getLogger().debug('Session updated', { sessionId, title })
    }
  }

  private async handleTodoUpdated(sessionId: string, state: SessionState, data: any): Promise<void> {
    const todos = data.todos || []
    if (todos.length === 0) return

    // Build a concise todo summary
    const activeTodos = todos.filter((t: any) => t.status !== 'completed')
    const completedCount = todos.length - activeTodos.length
    const summary = activeTodos.slice(0, 5).map((t: any) => {
      const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜'
      return `${icon} ${t.content || ''}`
    }).join('\n')

    let msg = `📋 *Todo List* (${completedCount}/${todos.length} completed)\n${escapeMarkdown(summary)}`
    if (activeTodos.length > 5) {
      msg += `\n_... and ${activeTodos.length - 5} more_`
    }
    this.queueMessage(state.chatId, msg, { parse_mode: 'Markdown' })
  }

  private async handleMessageRemoved(sessionId: string, state: SessionState, data: any): Promise<void> {
    // Message or part removed - mostly informational
    getLogger().debug('Message/part removed', { sessionId })
  }

  private async handleSessionStatus(sessionId: string, state: SessionState, data: any): Promise<void> {
    const status = data.status || data.state
    if (status === 'idle' && state.isWorking) {
      state.isWorking = false
      this.workingSessions.delete(sessionId)
      this.messageQueue.setIdle(state.chatId)
      this.queueMessage(state.chatId, '✅ *Session idle*', { parse_mode: 'Markdown' })
      await this.processNextQueuedMessage(sessionId, state.chatId)
    } else if ((status === 'active' || status === 'busy') && !state.isWorking) {
      state.isWorking = true
    }
  }

  /**
   * Register a session for event tracking
   */
  trackSession(sessionId: string, chatId: number): void {
    const log = getLogger()

    if (this.sessionStates.has(sessionId)) {
      log.debug('Session already tracked', { sessionId })
      return
    }

    this.sessionStates.set(sessionId, {
      chatId,
      isWorking: false
    })

    log.info('Session tracked', { sessionId, chatId })
  }

  /**
   * Clear tracking for a session (e.g., on abort or session change)
   */
  resetTracking(sessionId: string): void {
    const log = getLogger()
    log.info('Resetting session tracking', { sessionId })

    const state = this.sessionStates.get(sessionId)
    if (state) {
      this.messageQueue.clear(state.chatId)
    }

    this.sessionStates.delete(sessionId)
    this.workingSessions.delete(sessionId)
  }

  /**
   * Check if session is currently working
   */
  isSessionWorking(sessionId: string): boolean {
    const state = this.sessionStates.get(sessionId)
    return state?.isWorking || false
  }

  /**
   * Mark session as idle
   */
  markSessionIdle(sessionId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.isWorking = false
    }
    this.workingSessions.delete(sessionId)
  }

  /**
   * Set working message for a session
   */
  setWorkingMessage(sessionId: string, chatId: number, messageId: number): void {
    this.workingSessions.set(sessionId, { chatId, messageId })

    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.isWorking = true
    }
  }

  private async processNextQueuedMessage(sessionId: string, chatId: number): Promise<void> {
    const log = getLogger()

    const queuedMsg = this.messageQueue.dequeue(chatId)
    if (!queuedMsg) {
      this.messageQueue.setIdle(chatId)
      return
    }

    log.info('Processing queued message', { sessionId, chatId })

    try {
      const workingMsg = await this.bot.api.sendMessage(chatId, '⏳ Processing queued message...')
      this.setWorkingMessage(sessionId, chatId, workingMsg.message_id)

      const model = this.stateManager.getCurrentModel(chatId)
      const mode = this.stateManager.getCurrentMode(chatId)

      this.client.sendAsyncMessage(sessionId, queuedMsg.text, {
        providerId: model?.providerId,
        modelId: model?.modelId,
        agent: mode,
      }).catch((error: Error) => {
        log.error('Failed to send queued message', { error: error.message })
        this.messageQueue.setIdle(chatId)
        this.workingSessions.delete(sessionId)
        this.bot.api.sendMessage(chatId, `❌ Error: ${error.message.substring(0, 500)}`).catch(() => {})
      })
    } catch (error) {
      log.error('Failed to process queued message', { error: (error as Error).message })
      this.messageQueue.setIdle(chatId)
      this.workingSessions.delete(sessionId)
    }
  }

  private queueMessage(chatId: number, text: string, options?: any): void {
    if (!this.outgoingQueues.has(chatId)) {
      this.outgoingQueues.set(chatId, [])
    }
    this.outgoingQueues.get(chatId)!.push({ chatId, text, options })
    this.processOutgoingQueue(chatId)
  }

  private async processOutgoingQueue(chatId: number): Promise<void> {
    if (this.queueProcessing.has(chatId)) return
    this.queueProcessing.add(chatId)

    try {
      while (true) {
        const queue = this.outgoingQueues.get(chatId)
        if (!queue || queue.length === 0) break

        const msg = queue[0]
        try {
          if (msg.options?.editMessageId) {
            await this.bot.api.editMessageText(chatId, msg.options.editMessageId, msg.text, msg.options)
          } else {
            await this.bot.api.sendMessage(chatId, msg.text, msg.options).catch(async (err) => {
              if (msg.options?.parse_mode === 'Markdown' && (err.description?.includes('parse') || err.description?.includes('entity') || err.description?.includes('too long'))) {
                const escaped = escapeMarkdown(msg.text)
                const chunks = splitMessage(escaped)
                for (const chunk of chunks) {
                  await this.bot.api.sendMessage(chatId, chunk, { ...msg.options, parse_mode: undefined })
                }
                return
              }
              throw err
            })
          }
          queue.shift()
          await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY_MS))
        } catch (error: any) {
          if (error.description?.includes('rate limit') || error.error_code === 429) {
            const retryAfter = (error.parameters?.retry_after || 1) + 1
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
          } else {
            getLogger().error('Fatal Telegram send error', { error: error.message, text: msg.text.substring(0, 200) })
            queue.shift()
          }
        }
      }
    } finally {
      this.queueProcessing.delete(chatId)
    }
  }

  private async handleFilePart(chatId: number, part: any): Promise<void> {
    const filename = part.filename || part.source?.path || 'file'
    let msg = `${getFileIcon(filename)} \`${escapeMarkdown(filename)}\``
    if (part.source?.text?.value) {
      const snippet = part.source.text.value.substring(0, 150).trim()
      if (snippet) msg += `\n\`\`\`\n${snippet}\n\`\`\``
    }
    this.queueMessage(chatId, msg, { parse_mode: 'Markdown' })
  }

  stop(): void {
    this.running = false
    this.client.unsubscribeEvents()
    getLogger().info('Event processor stopped')
  }
}

interface SessionState {
  chatId: number
  isWorking: boolean
  currentStep?: string
}
