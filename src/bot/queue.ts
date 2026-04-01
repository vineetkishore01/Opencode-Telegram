import { getLogger } from '../utils/logger.js'

interface QueuedMessage {
  chatId: number
  text: string
  timestamp: number
  resolve: () => void
  reject: (error: Error) => void
}

export class MessageQueue {
  private queues = new Map<number, QueuedMessage[]>()
  private busyChats = new Set<number>()
  private readonly MAX_QUEUE_SIZE = 50
  private readonly QUEUE_TIMEOUT_MS = 30 * 60 * 1000

  setBusy(chatId: number): void {
    this.busyChats.add(chatId)
  }

  setIdle(chatId: number): void {
    this.busyChats.delete(chatId)
  }

  isBusy(chatId: number): boolean {
    return this.busyChats.has(chatId)
  }

  getQueueLength(chatId: number): number {
    return this.queues.get(chatId)?.length || 0
  }

  enqueue(chatId: number, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(chatId)) {
        this.queues.set(chatId, [])
      }
      const queue = this.queues.get(chatId)!
      if (queue.length >= this.MAX_QUEUE_SIZE) {
        reject(new Error('Queue is full (max 50 messages)'))
        return
      }
      queue.push({ chatId, text, timestamp: Date.now(), resolve, reject })
      getLogger().debug('Message enqueued', { chatId, queueLength: queue.length })
    })
  }

  dequeue(chatId: number): QueuedMessage | undefined {
    const queue = this.queues.get(chatId)
    if (!queue || queue.length === 0) return undefined
    return queue.shift()
  }

  clear(chatId: number): void {
    const queue = this.queues.get(chatId)
    if (queue) {
      for (const msg of queue) {
        msg.reject(new Error('Queue cleared'))
      }
      this.queues.delete(chatId)
    }
    this.busyChats.delete(chatId)
  }

  getStaleMessages(chatId: number): QueuedMessage[] {
    const queue = this.queues.get(chatId)
    if (!queue) return []
    const now = Date.now()
    const stale: QueuedMessage[] = []
    for (let i = queue.length - 1; i >= 0; i--) {
      if (now - queue[i].timestamp > this.QUEUE_TIMEOUT_MS) {
        const [removed] = queue.splice(i, 1)
        stale.push(removed)
      }
    }
    return stale
  }

  purgeStale(chatId: number): void {
    const stale = this.getStaleMessages(chatId)
    for (const msg of stale) {
      msg.reject(new Error('Message expired (timeout)'))
    }
  }
}
