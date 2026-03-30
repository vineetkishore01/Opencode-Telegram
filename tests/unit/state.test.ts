import { describe, it, expect } from 'vitest'

describe('State Manager', () => {
  it('should store and retrieve session', async () => {
    const { StateManager } = await import('../src/state/manager.js')
    const sm = new StateManager('/tmp/test-state.json')

    sm.setCurrentSession(123, 'sess-abc')
    expect(sm.getCurrentSession(123)).toBe('sess-abc')
    expect(sm.getChatIdForSession('sess-abc')).toBe(123)
  })

  it('should store and retrieve model', async () => {
    const { StateManager } = await import('../src/state/manager.js')
    const sm = new StateManager('/tmp/test-state.json')

    sm.setCurrentModel(123, 'anthropic', 'claude-3-opus')
    const model = sm.getCurrentModel(123)
    expect(model?.providerId).toBe('anthropic')
    expect(model?.modelId).toBe('claude-3-opus')
  })

  it('should track costs', async () => {
    const { StateManager } = await import('../src/state/manager.js')
    const sm = new StateManager('/tmp/test-state.json')

    sm.addCost('sess-1', 0.01, 100, 200, 50, 10, 5)
    sm.addCost('sess-1', 0.02, 150, 300, 60, 20, 10)

    const cost = sm.getCost('sess-1')
    expect(cost?.totalCost).toBeCloseTo(0.03)
    expect(cost?.messages).toBe(2)
    expect(cost?.totalInput).toBe(250)
  })

  it('should track prompt counts', async () => {
    const { StateManager } = await import('../src/state/manager.js')
    const sm = new StateManager('/tmp/test-state.json')

    expect(sm.getPromptCount(456)).toBe(0)
    sm.incrementPromptCount(456)
    sm.incrementPromptCount(456)
    expect(sm.getPromptCount(456)).toBe(2)
  })
})
