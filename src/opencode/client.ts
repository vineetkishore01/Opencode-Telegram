import * as http from 'http'
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

const REQUEST_TIMEOUT = 30000
const MAX_RETRIES = 3
const RETRY_BASE_DELAY = 1000

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Create a persistent agent for all requests
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: 60000,
})

export class OpenCodeClient {
  private baseUrl: string
  private auth?: { username: string; password: string }
  private hostname: string
  private port: number

  constructor(baseUrl: string, auth?: { username: string; password: string }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.auth = auth
    
    const url = new URL(this.baseUrl)
    this.hostname = url.hostname
    this.port = parseInt(url.port) || 80
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

  private async request<T>(endpoint: string, options: any = {}, retries = MAX_RETRIES): Promise<T> {
    const method = options.method || 'GET'
    const headers = { ...this.buildHeaders(), ...(options.headers || {}) }
    const log = getLogger()

    log.debug('Outgoing API request', { method, endpoint, body: options.body })

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const reqOptions = {
            hostname: this.hostname,
            port: this.port,
            path: endpoint,
            method: method,
            headers: headers,
            timeout: REQUEST_TIMEOUT,
            agent: httpAgent, // Use the persistent agent
          }

          const req = http.request(reqOptions, (res) => {
            let data = ''
            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
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
                reject(new Error(`OpenCode API error: ${res.statusCode} ${res.statusMessage}`))
              }
            })
          })

          req.on('error', (err) => reject(err))
          req.on('timeout', () => {
            req.destroy()
            reject(new Error('Request timeout'))
          })

          if (options.body) {
            req.write(options.body)
          }
          req.end()
        })
      } catch (error) {
        const isRetryable = attempt < retries && (
          (error as any).code === 'ECONNRESET' || 
          (error as any).code === 'ECONNREFUSED' || 
          (error as Error).message === 'terminated' ||
          (error as Error).message === 'Request timeout'
        )

        if (!isRetryable) throw error

        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt)
        log.warn(`API request failed, retrying in ${delay}ms`, { method, endpoint, attempt: attempt + 1, error: (error as Error).message })
        await sleep(delay)
      }
    }

    throw new Error('Request failed after retries')
  }

  async createSession(directory?: string): Promise<SessionInfo> {
    return this.request<SessionInfo>('/session', {
      method: 'POST',
      body: JSON.stringify({ directory }),
    })
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    return this.request<SessionInfo>(`/session/${sessionId}`)
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
    await this.request<void>(`/session/${sessionId}`, { method: 'DELETE' })
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
    return this.request<MessageInfo>(`/session/${sessionId}/message`, {
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
    await this.request<void>(`/session/${sessionId}/prompt_async`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async getMessages(sessionId: string, limit?: number): Promise<MessageInfo[]> {
    const params = limit ? `?limit=${limit}` : ''
    return this.request<MessageInfo[]>(`/session/${sessionId}/message${params}`)
  }

  async listProviders(): Promise<Provider[]> {
    try {
      const response = await this.request<any>('/provider')
      const providers = response.all || response.providers || response
      const providerList = Array.isArray(providers) ? providers : Object.values(providers)
      return providerList.filter((p: any) => typeof p === 'object' && p && p.id)
    } catch (error) {
      getLogger().warn('Failed to list providers', { error: (error as Error).message })
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
    } catch (error) {
      getLogger().warn('Failed to list models', { error: (error as Error).message })
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
    return this.request<PermissionRequest[]>('/permission/')
  }

  async replyPermission(requestId: string, reply: PermissionReply, message?: string): Promise<void> {
    await this.request<void>(`/permission/${requestId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply, message }),
    })
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request<void>(`/session/${sessionId}/abort`, { method: 'POST' })
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
    await this.request<void>(`/question/${questionId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    })
  }

  async rejectQuestion(questionId: string): Promise<void> {
    await this.request<void>(`/question/${questionId}/reject`, { method: 'POST' })
  }

  async getSessionTodo(sessionId: string): Promise<Array<{ content: string; status: string; priority: string }>> {
    try {
      return await this.request(`/session/${sessionId}/todo`)
    } catch {
      return []
    }
  }

  async getSessionDiff(sessionId: string): Promise<Array<{ file: string; additions: number; deletions: number; status: string }>> {
    try {
      return await this.request(`/session/${sessionId}/diff`)
    } catch {
      return []
    }
  }
}
