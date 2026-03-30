import { z } from 'zod'

// OpenCode API Types
export const SessionInfo = z.object({
  id: z.string(),
  title: z.string().optional(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  summary: z.object({
    additions: z.number().optional(),
    deletions: z.number().optional(),
    files: z.number().optional(),
  }).optional(),
})
export type SessionInfo = z.infer<typeof SessionInfo>

export const MessagePart = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.enum(['text', 'reasoning', 'tool', 'file', 'step-start', 'step-finish', 'patch', 'snapshot', 'retry', 'subtask']),
  text: z.string().optional(),
  tool: z.string().optional(),
  state: z.any().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  tokens: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    reasoning: z.number().optional(),
    cache: z.object({
      read: z.number().optional(),
      write: z.number().optional(),
    }).optional(),
  }).optional(),
  cost: z.number().optional(),
  attempt: z.number().optional(),
  error: z.any().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
})
export type MessagePart = z.infer<typeof MessagePart>

export const MessageInfo = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.enum(['user', 'assistant']),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  parts: MessagePart.array().optional(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number().optional(),
      write: z.number().optional(),
    }).optional(),
  }).optional(),
  cost: z.number().optional(),
})
export type MessageInfo = z.infer<typeof MessageInfo>

export const PermissionRequest = z.object({
  id: z.string(),
  sessionID: z.string(),
  permission: z.string(),
  patterns: z.string().array(),
  metadata: z.record(z.string(), z.any()),
  always: z.string().array().optional(),
})
export type PermissionRequest = z.infer<typeof PermissionRequest>

export const PermissionReply = z.enum(['once', 'always', 'reject'])
export type PermissionReply = z.infer<typeof PermissionReply>

// Bot State Types
export interface BotState {
  sessions: Map<number, string>
  lastUpdateId?: number
}

export interface SessionMapping {
  chatId: number
  sessionId: string
  sessionInfo?: SessionInfo
}

// Event Types
export interface Event {
  type: string
  properties: any
}

export interface PermissionEvent extends Event {
  type: 'permission.asked'
  properties: PermissionRequest
}

export interface MessagePartDeltaEvent extends Event {
  type: 'message.part.delta'
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

export interface MessageUpdatedEvent extends Event {
  type: 'message.updated'
  properties: {
    sessionID: string
    info: MessageInfo
  }
}

export interface FileUpdatedEvent extends Event {
  type: 'file.updated'
  properties: {
    sessionID: string
    path: string
    type: 'created' | 'modified' | 'deleted'
  }
}

export interface PtyUpdatedEvent extends Event {
  type: 'pty.updated'
  properties: {
    id: string
    sessionID: string
    output?: string
    exitCode?: number
  }
}

export interface QuestionAskedEvent extends Event {
  type: 'question.asked'
  properties: {
    id: string
    sessionID: string
    question: string
    options?: string[]
    header?: string
  }
}

export interface SessionErrorEvent extends Event {
  type: 'session.error'
  properties: {
    sessionID?: string
    error?: {
      name: string
      message: string
    }
  }
}

export interface SessionStatusEvent extends Event {
  type: 'session.status'
  properties: {
    sessionID: string
    status: {
      type: 'idle' | 'busy' | 'retry'
      attempt?: number
      message?: string
      next?: number
    }
  }
}

export interface TodoUpdatedEvent extends Event {
  type: 'todo.updated'
  properties: {
    sessionID: string
    todos: Array<{ content: string; status: string; priority: string }>
  }
}

// Configuration
export interface BotConfig {
  telegramToken: string
  authorizedUserId: string
  openCodeUrl: string
  openCodeUsername?: string
  openCodePassword?: string
  stateFile: string
  logFile: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}
