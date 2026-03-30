import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { z } from 'zod'
import { getLogger } from '../utils/logger.js'

export interface SelectedModel {
  providerId: string
  modelId: string
}

export interface ChatState {
  sessionId?: string
  model?: SelectedModel
  mode?: string
}

const SavedStateSchema = z.object({
  sessions: z.array(z.tuple([z.number(), z.string()])),
  models: z.array(z.tuple([z.number(), z.object({ providerId: z.string(), modelId: z.string() })])),
  modes: z.array(z.tuple([z.number(), z.string()])),
  lastUpdateId: z.number().optional(),
  costTracking: z.record(z.string(), z.object({
    totalCost: z.number(),
    totalInput: z.number(),
    totalOutput: z.number(),
    totalReasoning: z.number(),
    totalCacheRead: z.number(),
    totalCacheWrite: z.number(),
    messages: z.number(),
  })).optional(),
  promptCounters: z.record(z.string(), z.number()).optional(),
}).passthrough()

export interface CostEntry {
  totalCost: number
  totalInput: number
  totalOutput: number
  totalReasoning: number
  totalCacheRead: number
  totalCacheWrite: number
  messages: number
}

export class StateManager {
  private state: {
    sessions: Map<number, string>
    models: Map<number, SelectedModel>
    modes: Map<number, string>
    lastUpdateId?: number
    costTracking: Map<string, CostEntry>
    promptCounters: Map<number, number>
  }
  private stateFile: string

  constructor(stateFile: string = 'bot-state.json') {
    this.stateFile = stateFile
    this.state = {
      sessions: new Map(),
      models: new Map(),
      modes: new Map(),
      costTracking: new Map(),
      promptCounters: new Map(),
    }
  }

  async load(): Promise<void> {
    try {
      const data = await readFile(this.stateFile, 'utf-8')
      const parsed = SavedStateSchema.parse(JSON.parse(data))
      this.state = {
        sessions: new Map(parsed.sessions || []),
        models: new Map(parsed.models || []),
        modes: new Map(parsed.modes || []),
        lastUpdateId: parsed.lastUpdateId,
        costTracking: new Map(
          Object.entries(parsed.costTracking || {}).map(([k, v]) => [k, v])
        ),
        promptCounters: new Map(
          Object.entries(parsed.promptCounters || {}).map(([k, v]) => [parseInt(k), v])
        ),
      }
      getLogger().info('State loaded', {
        sessions: this.state.sessions.size,
        models: this.state.models.size,
        modes: this.state.modes.size
      })
    } catch {
      getLogger().info('No existing state found, starting fresh')
    }
  }

  async save(): Promise<void> {
    const dir = dirname(this.stateFile)
    await mkdir(dir, { recursive: true })

    const data = {
      sessions: Array.from(this.state.sessions.entries()),
      models: Array.from(this.state.models.entries()),
      modes: Array.from(this.state.modes.entries()),
      lastUpdateId: this.state.lastUpdateId,
      costTracking: Object.fromEntries(this.state.costTracking),
      promptCounters: Object.fromEntries(this.state.promptCounters),
    }
    await writeFile(this.stateFile, JSON.stringify(data, null, 2))
  }

  setCurrentSession(chatId: number, sessionId: string): void {
    this.state.sessions.set(chatId, sessionId)
    this.save().catch(() => {})
  }

  getCurrentSession(chatId: number): string | undefined {
    return this.state.sessions.get(chatId)
  }

  clearCurrentSession(chatId: number): void {
    this.state.sessions.delete(chatId)
    this.save().catch(() => {})
  }

  getChatIdForSession(sessionId: string): number | undefined {
    for (const [chatId, sid] of this.state.sessions.entries()) {
      if (sid === sessionId) return chatId
    }
    return undefined
  }

  setCurrentModel(chatId: number, providerId: string, modelId: string): void {
    this.state.models.set(chatId, { providerId, modelId })
    this.save().catch(() => {})
  }

  getCurrentModel(chatId: number): SelectedModel | undefined {
    return this.state.models.get(chatId)
  }

  clearCurrentModel(chatId: number): void {
    this.state.models.delete(chatId)
    this.save().catch(() => {})
  }

  setCurrentMode(chatId: number, mode: string): void {
    this.state.modes.set(chatId, mode)
    this.save().catch(() => {})
  }

  getCurrentMode(chatId: number): string | undefined {
    return this.state.modes.get(chatId)
  }

  clearCurrentMode(chatId: number): void {
    this.state.modes.delete(chatId)
    this.save().catch(() => {})
  }

  getChatState(chatId: number): ChatState {
    return {
      sessionId: this.getCurrentSession(chatId),
      model: this.getCurrentModel(chatId),
      mode: this.getCurrentMode(chatId),
    }
  }

  clearChatState(chatId: number): void {
    this.state.sessions.delete(chatId)
    this.state.models.delete(chatId)
    this.state.modes.delete(chatId)
    this.save().catch(() => {})
  }

  setLastUpdateId(updateId: number): void {
    this.state.lastUpdateId = updateId
  }

  getLastUpdateId(): number | undefined {
    return this.state.lastUpdateId
  }

  addCost(sessionId: string, cost: number, input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number): void {
    const existing = this.state.costTracking.get(sessionId) || {
      totalCost: 0, totalInput: 0, totalOutput: 0,
      totalReasoning: 0, totalCacheRead: 0, totalCacheWrite: 0, messages: 0,
    }
    existing.totalCost += cost
    existing.totalInput += input
    existing.totalOutput += output
    existing.totalReasoning += reasoning
    existing.totalCacheRead += cacheRead
    existing.totalCacheWrite += cacheWrite
    existing.messages += 1
    this.state.costTracking.set(sessionId, existing)
    this.save().catch(() => {})
  }

  getCost(sessionId: string): CostEntry | undefined {
    return this.state.costTracking.get(sessionId)
  }

  incrementPromptCount(chatId: number): number {
    const current = this.state.promptCounters.get(chatId) || 0
    const next = current + 1
    this.state.promptCounters.set(chatId, next)
    this.save().catch(() => {})
    return next
  }

  getPromptCount(chatId: number): number {
    return this.state.promptCounters.get(chatId) || 0
  }

  getAllChatIds(): number[] {
    return Array.from(this.state.sessions.keys())
  }
}
