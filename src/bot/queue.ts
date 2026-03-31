import { getLogger } from '../utils/logger.js'
import { StateManager } from '../state/manager.js'

interface QueuedMessage {
  chatId: number
  text: string
}

export class MessageQueue {
  private queues = new Map<number, QueuedMessage[]>()
  private busyChats = new Set<number>()
  private busyTimeouts = new Map<number, NodeJS.Timeout>()
  private lastBusyTime = new Map<number, number>()

  constructor(private stateManager: StateManager) {}

  loadPersisted(): void {
    try {
      const persisted = this.stateManager.getQueuedMessages()
      for (const msg of persisted) {
        if (typeof msg.chatId !== 'number' || typeof msg.text !== 'string') continue
        if (!this.queues.has(msg.chatId)) this.queues.set(msg.chatId, [])
        this.queues.get(msg.chatId)!.push(msg)
      }
      // Restore busy state for chats with queued messages
      for (const [chatId, queue] of this.queues) {
        if (queue.length > 0 && !this.busyChats.has(chatId)) {
          this.setBusy(chatId)
        }
      }
    } catch (err) {
      getLogger().error('Failed to load persisted queue', { error: (err as Error).message })
    }
  }

  setBusy(chatId: number): void {
    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId)!)
    }
    this.busyChats.add(chatId)
    this.lastBusyTime.set(chatId, Date.now())
    const timeout = setTimeout(() => {
      this.busyTimeouts.delete(chatId)
      if (this.isBusy(chatId)) {
        getLogger().warn('Safety timeout: marking chat IDLE', { chatId })
        this.setIdle(chatId)
      }
    }, 90_000)
    timeout.unref()
    this.busyTimeouts.set(chatId, timeout)
  }

  setIdle(chatId: number): void {
    this.busyChats.delete(chatId)
    this.lastBusyTime.delete(chatId)
    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId)!)
      this.busyTimeouts.delete(chatId)
    }
  }

  isBusy(chatId: number): boolean {
    return this.busyChats.has(chatId)
  }

  getQueueLength(chatId: number): number {
    return this.queues.get(chatId)?.length || 0
  }

  enqueue(chatId: number, text: string): void {
    if (!this.queues.has(chatId)) this.queues.set(chatId, [])
    const queue = this.queues.get(chatId)!
    if (queue.some(m => m.text === text)) return
    queue.push({ chatId, text })
    this.stateManager.addQueuedMessage(chatId, text)
  }

  dequeue(chatId: number): QueuedMessage | undefined {
    const queue = this.queues.get(chatId)
    if (!queue || queue.length === 0) return undefined
    const msg = queue.shift()!
    this.stateManager.removeQueuedMessage(msg.chatId, msg.text)
    if (queue.length === 0) this.queues.delete(chatId)
    return msg
  }

  clear(chatId: number): void {
    const queue = this.queues.get(chatId)
    if (queue) {
      for (const msg of queue) this.stateManager.removeQueuedMessage(msg.chatId, msg.text)
    }
    this.queues.delete(chatId)
    this.busyChats.delete(chatId)
    this.lastBusyTime.delete(chatId)
    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId)!)
      this.busyTimeouts.delete(chatId)
    }
  }

  getBusyDuration(chatId: number): number {
    const start = this.lastBusyTime.get(chatId)
    return start ? Date.now() - start : 0
  }
}
