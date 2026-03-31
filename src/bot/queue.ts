import { getLogger } from '../utils/logger.js'

interface QueuedMessage {
  chatId: number
  text: string
}

export class MessageQueue {
  private queues = new Map<number, QueuedMessage[]>()
  private busyChats = new Set<number>()
  private busyTimeouts = new Map<number, NodeJS.Timeout>()
  private lastBusyTime = new Map<number, number>()

  setBusy(chatId: number): void {
    getLogger().info('Chat marked BUSY', { chatId })
    this.busyChats.add(chatId)
    this.lastBusyTime.set(chatId, Date.now())

    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId))
    }

    // Reduced safety timeout: 90 seconds instead of 5 minutes
    const timeout = setTimeout(() => {
      if (this.isBusy(chatId)) {
        const elapsed = ((Date.now() - (this.lastBusyTime.get(chatId) || 0)) / 1000).toFixed(0)
        getLogger().warn('Safety timeout: marking chat IDLE after inactivity', { chatId, elapsedSeconds: elapsed })
        this.setIdle(chatId)
      }
    }, 90 * 1000)
    
    this.busyTimeouts.set(chatId, timeout)
  }

  setIdle(chatId: number): void {
    getLogger().info('Chat marked IDLE', { chatId })
    this.busyChats.delete(chatId)
    this.lastBusyTime.delete(chatId)
    
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

  enqueue(chatId: number, text: string): void {
    if (!this.queues.has(chatId)) {
      this.queues.set(chatId, [])
    }
    this.queues.get(chatId)!.push({ chatId, text })
    getLogger().debug('Message enqueued', { chatId, queueLength: this.queues.get(chatId)!.length })
  }

  dequeue(chatId: number): QueuedMessage | undefined {
    const queue = this.queues.get(chatId)
    if (!queue || queue.length === 0) return undefined
    return queue.shift()
  }

  clear(chatId: number): void {
    this.queues.delete(chatId)
    this.busyChats.delete(chatId)
    this.lastBusyTime.delete(chatId)
    if (this.busyTimeouts.has(chatId)) {
      clearTimeout(this.busyTimeouts.get(chatId))
      this.busyTimeouts.delete(chatId)
    }
  }

  getBusyDuration(chatId: number): number {
    const startTime = this.lastBusyTime.get(chatId)
    if (!startTime) return 0
    return Date.now() - startTime
  }
}
