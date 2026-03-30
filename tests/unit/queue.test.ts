import { describe, it, expect } from 'vitest'

describe('Message Queue', () => {
  it('should track busy state', async () => {
    const { MessageQueue } = await import('../src/bot/queue.js')
    const queue = new MessageQueue()

    expect(queue.isBusy(123)).toBe(false)
    queue.setBusy(123)
    expect(queue.isBusy(123)).toBe(true)
    queue.setIdle(123)
    expect(queue.isBusy(123)).toBe(false)
  })

  it('should enqueue and dequeue messages', async () => {
    const { MessageQueue } = await import('../src/bot/queue.js')
    const queue = new MessageQueue()

    const p = queue.enqueue(123, 'hello')
    expect(queue.getQueueLength(123)).toBe(1)

    const msg = queue.dequeue(123)
    expect(msg?.text).toBe('hello')
    expect(queue.getQueueLength(123)).toBe(0)

    // Resolve the promise
    msg?.resolve()
    await p
  })

  it('should clear queue', async () => {
    const { MessageQueue } = await import('../src/bot/queue.js')
    const queue = new MessageQueue()

    queue.enqueue(123, 'msg1')
    queue.enqueue(123, 'msg2')
    expect(queue.getQueueLength(123)).toBe(2)

    queue.clear(123)
    expect(queue.getQueueLength(123)).toBe(0)
  })
})
