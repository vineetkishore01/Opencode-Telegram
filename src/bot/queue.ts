import { getLogger } from '../utils/logger.js'

interface QueuedMessage {
  chatId: number
  text: string
  resolve: () => void
  reject: (error: Error) => void
}

export class MessageQueue {
  private queues = new Map<number, QueuedMessage[]>()
  private busyChats = new Set<number>()

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
      this.queues.get(chatId)!.push({ chatId, text, resolve, reject })
      getLogger().debug('Message enqueued', { chatId, queueLength: this.queues.get(chatId)!.length })
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
}
