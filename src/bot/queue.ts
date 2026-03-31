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
  private busyTimeouts = new Map<number, NodeJS.Timeout>()

  setBusy(chatId: number): void {
    getLogger().info('Chat marked BUSY', { chatId })
    this.busyChats.add(chatId)

    // Clear existing timeout if any
    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId))
    }

    // Set a safety timeout (5 minutes) to prevent permanent hang
    const timeout = setTimeout(() => {
      if (this.isBusy(chatId)) {
        getLogger().warn('Safety timeout: marking chat IDLE after 5 minutes of inactivity', { chatId })
        this.setIdle(chatId)
      }
    }, 5 * 60 * 1000)
    
    this.busyTimeouts.set(chatId, timeout)
  }

  setIdle(chatId: number): void {
    getLogger().info('Chat marked IDLE', { chatId })
    this.busyChats.delete(chatId)
    
    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId))
      this.busyTimeouts.delete(chatId)
    }
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
