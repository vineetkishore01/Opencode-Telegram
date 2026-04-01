import * as http from 'http'
import * as https from 'https'
import { SessionInfo, MessageInfo, PermissionRequest, PermissionReply } from '../types/index.js'
import { getLogger } from '../utils/logger.js'

export interface Model {
  id: string
  name: string
  providerId: string
}

export interface Agent {
  name: string
  description?: string
}

export interface Provider {
  id: string
  name?: string
  models: Record<string, { id: string; name?: string }>
}

export interface OpenCodeEvent {
  type: string
  sessionId?: string
  data: any
}

export type EventHandler = (event: OpenCodeEvent) => void

const REQUEST_TIMEOUT = 30000

export class OpenCodeClient {
  private baseUrl: string
  private auth?: { username: string; password: string }
  private hostname: string
  private port: number
  private isHttps: boolean
  private log = getLogger()

  constructor(baseUrl: string, auth?: { username: string; password: string }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.auth = auth

    const url = new URL(this.baseUrl)
    this.hostname = url.hostname
    this.port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80)
    this.isHttps = url.protocol === 'https:'
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.auth) {
      const credentials = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }
    return headers
  }

  private async request<T>(endpoint: string, options: any = {}): Promise<T> {
    const method = options.method || 'GET'
    const headers = { ...this.buildHeaders(), ...(options.headers || {}) }

    return new Promise((resolve, reject) => {
      const transport = this.isHttps ? https : http
      const reqOptions = {
        hostname: this.hostname,
        port: this.port,
        path: endpoint,
        method: method,
        headers: headers,
        timeout: REQUEST_TIMEOUT,
      }

      const req = transport.request(reqOptions, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const data = Buffer.concat(chunks).toString()
            if (!data || data.trim() === '') {
              resolve({} as T)
              return
            }
            try {
              resolve(JSON.parse(data) as T)
            } catch {
              resolve(data as any)
            }
          } else {
            const data = Buffer.concat(chunks).toString()
            reject(new Error(`OpenCode API error: ${res.statusCode} - ${data}`))
          }
        })
      })

      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('Request timeout')))

      if (options.body) {
        const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
        req.write(body)
      }
      req.end()
    })
  }

  /**
   * Subscribe to SSE events for real-time updates
   */
  async subscribeEvents(handler: EventHandler): Promise<void> {
    this.log.info('Subscribing to OpenCode event stream')

    return new Promise((resolve, reject) => {
      const transport = this.isHttps ? https : http
      const req = transport.get({
        hostname: this.hostname,
        port: this.port,
        path: '/event',
        headers: this.buildHeaders(),
        timeout: REQUEST_TIMEOUT,
      })

      req.on('error', (err) => {
        this.log.warn('SSE connection failed', { error: err.message })
        resolve() // Resolve anyway - events won't be received
      })

      req.on('response', (res) => {
        if (res.statusCode !== 200) {
          this.log.warn('SSE not available', { statusCode: res.statusCode })
          resolve()
          return
        }

        this.log.info('Connected to SSE stream')
        let buffer = ''

        res.on('data', (chunk) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                const event: OpenCodeEvent = {
                  type: data.type,
                  sessionId: data.properties?.sessionID || data.properties?.sessionId,
                  data: data.properties
                }
                handler(event)
              } catch (err) {
                this.log.debug('Failed to parse SSE event', { error: (err as Error).message })
              }
            }
          }
        })
      })

      req.end()
    })
  }

  unsubscribeEvents(): void {
    this.log.info('SSE subscription ended')
  }

  async createSession(directory?: string): Promise<SessionInfo> {
    return this.request<SessionInfo>('/session', {
      method: 'POST',
      body: JSON.stringify({ directory }),
    })
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    return this.request<SessionInfo>(`/session/${encodeURIComponent(sessionId)}`)
  }

  async listSessions(options?: { directory?: string; limit?: number; search?: string }): Promise<SessionInfo[]> {
    const params = new URLSearchParams()
    if (options?.directory) params.set('directory', options.directory)
    if (options?.limit) params.set('limit', options.limit.toString())
    if (options?.search) params.set('search', options.search)
    const query = params.toString() ? `?${params}` : ''
    return this.request<SessionInfo[]>(`/session${query}`)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<void>(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
  }

  async sendMessage(sessionId: string, content: string, options?: {
    providerId?: string
    modelId?: string
    agent?: string
  }): Promise<MessageInfo> {
    const body: any = {
      parts: [{ type: 'text', text: content }],
    }
    if (options?.providerId && options?.modelId) {
      body.providerID = options.providerId
      body.modelID = options.modelId
    }
    if (options?.agent) {
      body.agent = options.agent
    }
    return this.request<MessageInfo>(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async sendAsyncMessage(sessionId: string, content: string, options?: {
    providerId?: string
    modelId?: string
    agent?: string
  }): Promise<void> {
    const body: any = {
      parts: [{ type: 'text', text: content }],
    }
    if (options?.providerId && options?.modelId) {
      body.providerID = options.providerId
      body.modelID = options.modelId
    }
    if (options?.agent) {
      body.agent = options.agent
    }
    await this.request<void>(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async getMessages(sessionId: string, limit?: number): Promise<MessageInfo[]> {
    const params = limit ? `?limit=${limit}` : ''
    return this.request<MessageInfo[]>(`/session/${encodeURIComponent(sessionId)}/message${params}`)
  }

  async listProviders(): Promise<Provider[]> {
    try {
      const response = await this.request<any>('/provider')
      const providers = response.all || response.providers || response
      const providerList = Array.isArray(providers) ? providers : Object.values(providers)
      return providerList.filter((p: any) => typeof p === 'object' && p && p.id)
    } catch {
      return []
    }
  }

  async listModels(providerId?: string): Promise<Model[]> {
    try {
      const response = await this.request<any>('/provider')
      const models: Model[] = []

      const providers = response.all || response.providers || response
      const providerList = Array.isArray(providers) ? providers : Object.values(providers)

      for (const provider of providerList) {
        if (typeof provider !== 'object' || !provider) continue
        const pid = provider.id || provider.name || 'unknown'
        if (providerId && pid !== providerId) continue

        const providerModels = provider.models || {}

        if (Array.isArray(providerModels)) {
          for (const model of providerModels) {
            models.push({
              id: model.id || model.name,
              name: model.name || model.id,
              providerId: pid,
            })
          }
        } else if (typeof providerModels === 'object') {
          for (const [modelId, modelData] of Object.entries(providerModels)) {
            const model = modelData as any
            models.push({
              id: model.id || modelId,
              name: model.name || modelId,
              providerId: pid,
            })
          }
        }
      }

      return models
    } catch {
      return []
    }
  }

  async listAgents(): Promise<Agent[]> {
    try {
      const response = await this.request<any>('/agent')
      if (Array.isArray(response)) return response
      if (response.agents && Array.isArray(response.agents)) return response.agents
      return []
    } catch {
      return []
    }
  }

  async listPermissions(): Promise<PermissionRequest[]> {
    return this.request<PermissionRequest[]>('/permission')
  }

  async replyPermission(requestId: string, reply: PermissionReply, message?: string): Promise<void> {
    await this.request<void>(`/permission/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply, message }),
    })
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request<void>(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      body: '{}'
    })
  }

  async listFiles(dirPath?: string): Promise<{ entries: Array<{ name: string; path: string; isDir: boolean; size?: number }> }> {
    const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
    return this.request(`/file${params}`)
  }

  async getFileContent(filePath: string): Promise<{ content: string; path: string }> {
    return this.request(`/file/content?path=${encodeURIComponent(filePath)}`)
  }

  async searchCode(pattern: string): Promise<Array<{ path: string; line: number; text: string }>> {
    return this.request(`/find?pattern=${encodeURIComponent(pattern)}`)
  }

  async replyQuestion(questionId: string, answers: string[]): Promise<void> {
    await this.request<void>(`/question/${encodeURIComponent(questionId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    })
  }

  async rejectQuestion(questionId: string): Promise<void> {
    await this.request<void>(`/question/${encodeURIComponent(questionId)}/reject`, { method: 'POST' })
  }

  async getSessionTodo(sessionId: string): Promise<Array<{ content: string; status: string; priority: string }>> {
    try {
      return await this.request(`/session/${encodeURIComponent(sessionId)}/todo`)
    } catch {
      return []
    }
  }

  async getSessionDiff(sessionId: string): Promise<Array<{ file: string; additions: number; deletions: number; status: string }>> {
    try {
      return await this.request(`/session/${encodeURIComponent(sessionId)}/diff`)
    } catch {
      return []
    }
  }

  async getSessionStatus(sessionId: string): Promise<{ status: string; model?: string; agent?: string }> {
    return this.request(`/session/${sessionId}/status`)
  }
}
