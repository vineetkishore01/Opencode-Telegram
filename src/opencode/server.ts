import { spawn, ChildProcess } from 'child_process'
import { getLogger } from '../utils/logger.js'

const DEFAULT_PORT = 4097

// Global fetch for Node 18+
const _fetch = globalThis.fetch

export class OpenCodeServer {
  private process: ChildProcess | null = null
  private projectDir: string
  private port: number

  constructor(projectDir: string, port: number = DEFAULT_PORT) {
    this.projectDir = projectDir
    this.port = port
  }

  getPort(): number {
    return this.port
  }

  async start(withTunnel: boolean = false): Promise<void> {
    const log = getLogger()

    if (this.process && !this.process.killed) {
      throw new Error('Server is already running')
    }

    log.info('Starting OpenCode server...', { port: this.port, tunnel: withTunnel })

    const args = ['serve', '--port', this.port.toString()]
    
    // Only add --pure if tunnel is NOT requested (default: no tunnels)
    if (!withTunnel) {
      args.push('--pure')
    }

    return new Promise((resolve, reject) => {
      this.process = spawn('opencode', args, {
        cwd: this.projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      })

      let started = false
      let errorOutput = ''
      let outputBuffer = ''
      
      // Give OpenCode more time to start (60 seconds for large projects)
      const timeout = setTimeout(() => {
        if (!started) {
          this.process?.kill()
          const errorMsg = errorOutput || 'OpenCode server failed to start within 60 seconds'
          log.error('OpenCode startup timeout', { error: errorMsg })
          reject(new Error(errorMsg))
        }
      }, 60000)

      this.process.stdout?.on('data', (data) => {
        const output = data.toString()
        outputBuffer += output
        log.info('OpenCode', { output: output.trim() })

        // Check for various startup messages
        if (output.includes('Server listening') || 
            output.includes('started on port') ||
            output.includes('Listening on') ||
            output.includes('http://') ||
            output.includes('Ready')) {
          if (!started) {
            started = true
            clearTimeout(timeout)
            log.info('OpenCode server started', { port: this.port })
            resolve()
          }
        }
      })

      this.process.stderr?.on('data', (data) => {
        const output = data.toString()
        errorOutput += output
        log.warn('OpenCode', { output: output.trim() })
        
        // Check for common errors
        if (output.includes('address already in use') || 
            output.includes('EADDRINUSE') ||
            output.includes('port') && output.includes('in use')) {
          if (!started) {
            started = true // Prevent timeout reject
            clearTimeout(timeout)
            this.process?.kill()
            reject(new Error(`Port ${this.port} is already in use. Stop the existing server or use: opencode-tele -p <port>`))
          }
        }
      })

      this.process.on('error', (error) => {
        clearTimeout(timeout)
        log.error('Failed to start OpenCode server', { error: error.message })
        reject(error)
      })

      this.process.on('close', (code) => {
        clearTimeout(timeout)
        if (!started) {
          const errorMsg = errorOutput || `OpenCode server exited with code ${code}`
          reject(new Error(errorMsg))
        } else {
          log.warn('OpenCode server process exited', { code })
        }
      })
      
      // Also check buffer after a delay in case startup message was missed
      setTimeout(() => {
        if (!started && outputBuffer.length > 0) {
          // Server might be running but we missed the message
          log.info('OpenCode appears to be running (checking...)')
          // Try to connect to verify
          _fetch(`http://127.0.0.1:${this.port}/session`, { signal: AbortSignal.timeout(2000) })
            .then(res => {
              if (res.ok && !started) {
                started = true
                clearTimeout(timeout)
                log.info('OpenCode server verified running', { port: this.port })
                resolve()
              }
            })
            .catch(() => {
              // Not running, continue waiting
            })
        }
      }, 5000)
    })
  }

  async stop(): Promise<void> {
    const log = getLogger()

    if (!this.process || this.process.killed) {
      return
    }

    return new Promise((resolve) => {
      log.info('Stopping OpenCode server...')

      this.process!.once('close', () => {
        this.process = null
        log.info('OpenCode server stopped')
        resolve()
      })

      this.process!.kill('SIGTERM')

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          log.warn('Force killing OpenCode server...')
          this.process.kill('SIGKILL')
        }
      }, 5000)
    })
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }
}
