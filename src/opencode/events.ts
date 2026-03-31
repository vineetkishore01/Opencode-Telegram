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

  constructor(
    private client: OpenCodeClient,
    private bot: Bot,
    private stateManager: StateManager,
    private permissionHandler: PermissionHandler,
    private messageQueue: MessageQueue
  ) {}

  private processedPartIds = new Set<string>()
  private isPolling = false
  private lastTextPerSession = new Map<string, string>()
  private recentlySentSessions = new Set<string>()
  private completedMessageIds = new Set<string>()
  private lastActivityTime = new Map<string, number>()
  private completedSessions = new Set<string>()
  private idleProcessing = new Set<string>()
  private pollCycleCount = 0

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const log = getLogger()
    log.info('Event processor started (Polling mode)')

    // Wait for server to settle BEFORE capturing current state
    console.log('⏳ Waiting 10s for OpenCode server to initialize...')
    await new Promise(resolve => setTimeout(resolve, 10000))
    console.log('✅ Initialization wait complete.')

    // Pre-populate processed parts AFTER server is settled
    const chatIds = this.stateManager.getAllChatIds()
    for (const chatId of chatIds) {
      const sessionId = this.stateManager.getCurrentSession(chatId)
      if (!sessionId) continue
      try {
        const messages = await this.client.getMessages(sessionId, 50)
        for (const msg of messages) {
          if (msg.parts) {
            for (const part of msg.parts) {
              if (msg.role === 'user') continue
              const msgId = msg.id || msg.time?.created?.toString() || ''
              const partId = part.id || ''
              const partKey = `${sessionId}:${msgId}:${partId}:${part.type}`
              this.processedPartIds.add(partKey)
              if (msg.role === 'assistant' && msg.time?.completed) {
                this.completedMessageIds.add(`${sessionId}:${msgId}`)
              }
            }
          }
        }
      } catch (e) {
        log.warn('Failed to pre-populate parts', { sessionId, error: (e as Error).message })
      }
    }

    while (this.running) {
      if (this.isPolling) {
        await new Promise(resolve => setTimeout(resolve, 500))
        continue
      }

      this.isPolling = true
      try {
        const currentChatIds = this.stateManager.getAllChatIds()

        // Auto-process queue if idle
        for (const chatId of currentChatIds) {
          if (!this.messageQueue.isBusy(chatId) && this.messageQueue.getQueueLength(chatId) > 0) {
            const sessionId = this.stateManager.getCurrentSession(chatId)
            if (sessionId) {
              await this.handleSessionIdle({ sessionID: sessionId })
            }
          }
        }

        await this.permissionHandler.checkPendingPermissions().catch((e) => getLogger().warn('Failed to check permissions', { error: (e as Error).message }))

        for (const chatId of currentChatIds) {
          if (!this.running) break
          const sessionId = this.stateManager.getCurrentSession(chatId)
          if (!sessionId) continue
          if (this.completedSessions.has(sessionId)) continue
          if (this.recentlySentSessions.has(sessionId)) continue

          try {
            const messages = await this.client.getMessages(sessionId, 10)
            let newPartsFound = false

            for (const msg of messages) {
              if (msg.role === 'assistant' && msg.time?.completed) {
                const msgId = msg.id || msg.time?.created?.toString() || ''
                const msgKey = `${sessionId}:${msgId}`
                if (!this.completedMessageIds.has(msgKey)) {
                  this.completedMessageIds.add(msgKey)
                  newPartsFound = true
                }
              }

              if (msg.parts) {
                for (const part of msg.parts) {
                  if (msg.role === 'user') continue
                  const msgId = msg.id || msg.time?.created?.toString() || ''
                  const partId = part.id || ''
                  const partKey = `${sessionId}:${msgId}:${partId}:${part.type}`

                  if (!this.processedPartIds.has(partKey)) {
                    newPartsFound = true
                    await this.handleMessagePartUpdated({ part, _sessionId: sessionId })
                    this.processedPartIds.add(partKey)
                  }
                }
              }
            }

            // Always reset activity timer on successful poll
            this.lastActivityTime.set(sessionId, Date.now())

            if (this.messageQueue.isBusy(chatId)) {
              const hasCompletedMessage = messages.some(m => {
                if (m.role !== 'assistant' || !m.time?.completed) return false
                const msgId = m.id || m.time?.created?.toString() || ''
                return this.completedMessageIds.has(`${sessionId}:${msgId}`)
              })

              if (hasCompletedMessage) {
                this.completedSessions.add(sessionId)
                await this.handleSessionIdle({ sessionID: sessionId })
                continue
              }

              // Inactivity fallback: 120s with no new parts
              const lastActivity = this.lastActivityTime.get(sessionId)
              if (lastActivity && Date.now() - lastActivity > 120000 && !newPartsFound) {
                const hasStepFinish = Array.from(this.processedPartIds).some(k => k.startsWith(`${sessionId}:`) && k.endsWith(':step-finish'))
                if (hasStepFinish) {
                  this.completedSessions.add(sessionId)
                  await this.handleSessionIdle({ sessionID: sessionId })
                  continue
                }
              }
            }

            // Prune old processed parts to prevent memory leak
            if (this.processedPartIds.size > 2000) {
              const items = Array.from(this.processedPartIds)
              for (const item of items.slice(0, 1000)) {
                this.processedPartIds.delete(item)
              }
            }

          } catch (e) {
            log.warn('Poll error for session', { sessionId, chatId, error: (e as Error).message })
            if (this.messageQueue.isBusy(chatId) && this.messageQueue.getBusyDuration(chatId) > 60000) {
              this.messageQueue.setIdle(chatId)
            }
          }
        }

        this.completedSessions.clear()
        this.recentlySentSessions.clear()

        // Periodic memory cleanup every 150 cycles (~5 min)
        this.pollCycleCount++
        if (this.pollCycleCount % 150 === 0) {
          const activeSessionIds = new Set<string>()
          for (const cid of currentChatIds) {
            const sid = this.stateManager.getCurrentSession(cid)
            if (sid) activeSessionIds.add(sid)
          }
          for (const key of this.lastTextPerSession.keys()) {
            if (!activeSessionIds.has(key)) this.lastTextPerSession.delete(key)
          }
          for (const key of this.lastActivityTime.keys()) {
            if (!activeSessionIds.has(key)) this.lastActivityTime.delete(key)
          }
          if (this.processedPartIds.size > 2000) {
            const items = Array.from(this.processedPartIds)
            for (const item of items.slice(0, 1000)) {
              this.processedPartIds.delete(item)
            }
          }
          if (this.completedMessageIds.size > 1000) {
            const items = Array.from(this.completedMessageIds)
            for (const item of items.slice(0, 500)) {
              this.completedMessageIds.delete(item)
            }
          }
        }

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

  resetActivityTimer(sessionId: string): void {
    this.lastActivityTime.set(sessionId, Date.now())
  }

  private async handleMessagePartUpdated(event: any): Promise<void> {
    const part = event.part
    if (!part) return

    let sessionID = part.sessionID || event._sessionId
    if (!sessionID) return

    const chatId = this.stateManager.getChatIdForSession(sessionID)
    if (!chatId) return

    if (part.type === 'reasoning' && part.text?.trim()) {
      const text = part.text.trim()
      const prefix = `🤔 *Thinking:*\n`
      const msg = prefix + escapeMarkdown(text.length > 3500 ? text.substring(0, 3500) + '...' : text)
      await this.bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'tool') {
      await this.handleToolPart(chatId, part)
    }

    if (part.type === 'text' && part.text?.trim() && !part.ignored && !part.synthetic) {
      const text = stripAnsi(part.text.trim())
      if (text && this.lastTextPerSession.get(sessionID) !== text) {
        this.lastTextPerSession.set(sessionID, text)
        const chunks = splitMessage(`📝 *Response:*\n${escapeMarkdown(text)}`)
        for (const chunk of chunks) {
          if (chunk.trim()) {
            await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() => {})
          }
        }
      }
    }

    if (part.type === 'file') {
      await this.handleFilePart(chatId, part)
    }

    if (part.type === 'step-start') {
      const title = part.title || part.stepName || 'Step started'
      await this.bot.api.sendMessage(chatId, `🚀 *${escapeMarkdown(title)}*`, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'step-finish') {
      await this.handleStepFinish(chatId, part)
    }

    if (part.type === 'snapshot') {
      const files = part.state?.files?.length || 0
      const lines = part.state?.lines || part.state?.lineCount || 0
      await this.bot.api.sendMessage(chatId, `📸 *Snapshot:* ${files} files, ${lines} lines`, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'retry') {
      const attempt = part.attempt || '?'
      const error = stripAnsi(part.error?.message || 'Unknown error').substring(0, 150)
      await this.bot.api.sendMessage(chatId, `🔄 *Retry ${attempt}*: ${escapeMarkdown(error)}`, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'subtask') {
      const desc = part.description || part.prompt?.substring(0, 100) || 'subtask'
      const agent = part.agent ? ` (${escapeMarkdown(part.agent)})` : ''
      await this.bot.api.sendMessage(chatId, `📋 *Subtask*${agent}: ${escapeMarkdown(desc)}`, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'agent') {
      await this.bot.api.sendMessage(chatId, `🤖 Agent: \`${escapeMarkdown(part.name || 'agent')}\``, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'compaction') {
      await this.bot.api.sendMessage(chatId, `📦 *Context compacted* (${part.overflow ? 'context overflow' : 'auto'})`, { parse_mode: 'Markdown' }).catch(() => {})
    }

    if (part.type === 'patch' && part.state?.files?.length > 0) {
      const files = part.state.files.slice(0, 5).map((f: string) => `\`${escapeMarkdown(f)}\``).join(', ')
      const more = part.state.files.length > 5 ? ` +${part.state.files.length - 5} more` : ''
      await this.bot.api.sendMessage(chatId, `📝 Patch: ${files}${more}`, { parse_mode: 'Markdown' }).catch(() => {})
    }
  }

  private async handleToolPart(chatId: number, part: any): Promise<void> {
    const toolName = part.tool || 'unknown'
    const icons: Record<string, string> = { bash: '🖥️', edit: '✏️', write: '📝', read: '📖', grep: '🔍', glob: '🔍', todowrite: '📋', websearch: '🌐' }
    const icon = icons[toolName] || '🔧'
    const names: Record<string, string> = { bash: 'Bash', edit: 'Edit', write: 'Write', read: 'Read', grep: 'Grep', glob: 'Glob', todowrite: 'Todo', websearch: 'Search' }
    const name = names[toolName] || toolName.charAt(0).toUpperCase() + toolName.slice(1)

    if (part.state?.status === 'running' && part.state?.title) {
      await this.bot.api.sendMessage(chatId, `⏳ ${icon} ${name}: ${escapeMarkdown(stripAnsi(part.state.title).substring(0, 100))}`, { parse_mode: 'Markdown' }).catch(() => {})
    } else if (part.state?.status === 'completed') {
      let msg = `${icon} ${name}`
      if (part.state?.title) msg += `: ${escapeMarkdown(stripAnsi(part.state.title))}`
      if (toolName === 'bash' && part.state?.output) {
        const out = stripAnsi(part.state.output).trim().substring(0, 200)
        if (out) msg += `\n\`\`\`\n${out}\n\`\`\``
      }
      await this.bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' }).catch(() => {})
    } else if (part.state?.status === 'error') {
      await this.bot.api.sendMessage(chatId, `❌ ${name} failed: ${escapeMarkdown(stripAnsi(part.state.error || 'Unknown error').substring(0, 200))}`, { parse_mode: 'Markdown' }).catch(() => {})
    } else {
      await this.bot.api.sendMessage(chatId, `🔧 ${name}`, { parse_mode: 'Markdown' }).catch(() => {})
    }
  }

  private async handleFilePart(chatId: number, part: any): Promise<void> {
    const filename = part.filename || part.source?.path || 'file'
    let msg = `${getFileIcon(filename)} \`${escapeMarkdown(filename)}\``
    if (part.source?.text?.value) {
      const snippet = part.source.text.value.substring(0, 150).trim()
      if (snippet) msg += `\n\`\`\`\n${snippet}\n\`\`\``
    }
    await this.bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' }).catch(() => {})
  }

  private async handleStepFinish(chatId: number, part: any): Promise<void> {
    const tokens = part.tokens
    const cost = part.cost
    if (!tokens && !cost) return

    let info = '📊 '
    if (tokens) {
      info += `${tokens.input || 0}→${tokens.output || 0} tokens`
      if (tokens.reasoning > 0) info += ` (${tokens.reasoning} reasoning)`
      if (tokens.cache?.read > 0 || tokens.cache?.write > 0) info += ` [cache: ${tokens.cache.read}r/${tokens.cache.write}w]`
    }
    if (cost > 0) info += ` • $${cost.toFixed(4)}`

    if (part.sessionID) {
      this.stateManager.addCost(part.sessionID, cost || 0, tokens?.input || 0, tokens?.output || 0, tokens?.reasoning || 0, tokens?.cache?.read || 0, tokens?.cache?.write || 0)
    }
    await this.bot.api.sendMessage(chatId, info).catch(() => {})
  }

  private async handleSessionIdle(event: any): Promise<void> {
    const sessionID = event.sessionID
    const chatId = this.stateManager.getChatIdForSession(sessionID)
    if (!chatId) return

    // Prevent concurrent idle processing for same session
    if (this.idleProcessing.has(sessionID)) return
    this.idleProcessing.add(sessionID)

    try {
      const working = this.workingSessions.get(sessionID)
      if (working) {
        await this.bot.api.editMessageText(working.chatId, working.messageId, '✅ Task completed!').catch(() => {
          this.workingSessions.delete(sessionID)
        })
      }

      this.messageQueue.setIdle(chatId)

      const next = this.messageQueue.dequeue(chatId)
      if (next) {
        this.messageQueue.setBusy(chatId)
        const model = this.stateManager.getCurrentModel(chatId)
        const mode = this.stateManager.getCurrentMode(chatId)

        try {
          const msg = await this.bot.api.sendMessage(chatId, '⏳ Processing next message...')
          this.setWorkingMessage(sessionID, chatId, msg.message_id)
          await this.client.sendAsyncMessage(sessionID, next.text, {
            providerId: model?.providerId, modelId: model?.modelId, agent: mode,
          })
          this.recentlySentSessions.add(sessionID)
        } catch (error) {
          getLogger().error('Failed to process queued message', { error: (error as Error).message })
          await this.bot.api.sendMessage(chatId, `❌ Error: ${(error as Error).message.substring(0, 500)}`).catch(() => {})
          this.messageQueue.setIdle(chatId)
          this.workingSessions.delete(sessionID)
        }
      } else {
        if (working) this.workingSessions.delete(sessionID)
        await this.bot.api.sendMessage(chatId, '✅ *Done!*', { parse_mode: 'Markdown' }).catch(() => {})
      }
    } finally {
      this.idleProcessing.delete(sessionID)
    }
  }
}
