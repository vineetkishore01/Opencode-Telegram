import { getLogger } from '../utils/logger.js'
import { StateManager } from '../state/manager.js'

interface QueuedMessage {
  chatId: number
  text: string
}

export class MessageQueue {
  private queues = new Map<number, QueuedMessage[]>()
  private busyChats = new Set<number>()
  private lastBusyTime = new Map<number, number>()

  constructor(private stateManager: StateManager) {}

  loadPersisted(): void {
    try {
      const persisted = this.stateManager.getQueuedMessages()
      // Clear stale messages from previous session - they're no longer valid
      for (const msg of persisted) {
        this.stateManager.removeQueuedMessage(msg.chatId, msg.text)
      }
      getLogger().info('Cleared stale persisted queue', { count: persisted.length })
    } catch (err) {
      getLogger().error('Failed to clear persisted queue', { error: (err as Error).message })
    }
  }

  setBusy(chatId: number): void {
    this.busyChats.add(chatId)
    this.lastBusyTime.set(chatId, Date.now())
  }

  setIdle(chatId: number): void {
    this.busyChats.delete(chatId)
    this.lastBusyTime.delete(chatId)
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
  }

  getBusyDuration(chatId: number): number {
    const start = this.lastBusyTime.get(chatId)
    return start ? Date.now() - start : 0
  }
}
