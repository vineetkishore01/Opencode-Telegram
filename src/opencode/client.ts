import { fetch } from 'undici'
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

export class OpenCodeClient {
  private baseUrl: string
  private auth?: { username: string; password: string }

  constructor(baseUrl: string, auth?: { username: string; password: string }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.auth = auth
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.auth) {
      const credentials = btoa(`${this.auth.username}:${this.auth.password}`)
      headers['Authorization'] = `Basic ${credentials}`
    }
    return headers
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retries = MAX_RETRIES): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const method = options.method || 'GET'
    const headers = { ...this.buildHeaders(), ...(options.headers as Record<string, string> || {}) }
    const log = getLogger()

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        const responseText = await response.text()

        if (!response.ok) {
          const errorBody = responseText.substring(0, 200)
          log.error('API Error', { method, url, status: response.status, body: errorBody })
          throw new Error(`OpenCode API error: ${response.status} ${response.statusText}`)
        }

        if (!responseText || responseText.trim() === '') {
          return {} as T
        }

        try {
          return JSON.parse(responseText) as T
        } catch (e) {
          // If we expected JSON but got something else, and it's not a success code,
          // we should have already thrown above. If it IS a success code but not JSON,
          // return as is (could be a plain string response).
          log.debug('Response is not JSON', { endpoint, length: responseText.length })
          return responseText as any
        }
      } catch (error) {
        lastError = error as Error
        const isAbort = (error as Error).name === 'AbortError'
        const isRetryable = isAbort || (error as any).code === 'ECONNRESET' || (error as any).code === 'ECONNREFUSED'

        if (!isRetryable || attempt >= retries) {
          if ((error as Error).message?.includes('OpenCode API error')) {
            throw error
          }
          log.error('API Request Failed', { method, url, error: (error as Error).message, attempt })
          throw error
        }

        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt)
        log.warn(`API request failed, retrying in ${delay}ms`, { method, url, attempt: attempt + 1, error: (error as Error).message })
        await sleep(delay)
      }
    }

    throw lastError || new Error('Request failed after retries')
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

  async *subscribeToEvents(): AsyncGenerator<any> {
    const url = `${this.baseUrl}/event`
    const headers: Record<string, string> = {}

    if (this.auth) {
      const credentials = btoa(`${this.auth.username}:${this.auth.password}`)
      headers['Authorization'] = `Basic ${credentials}`
    }

    const log = getLogger()
    log.info('Connecting to event stream')

    try {
      const response = await fetch(url, { headers })

      if (!response.ok) {
        throw new Error(`Failed to subscribe to events: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data.trim()) {
              try {
                const event = JSON.parse(data)
                if (event.type !== 'server.heartbeat') {
                  yield event
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } catch (error) {
      // Don't log here - events.ts handles reconnection logging
      throw error
    }
  }
}
