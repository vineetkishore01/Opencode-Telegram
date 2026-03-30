import { spawn, ChildProcess } from 'child_process'
import { createServer } from 'net'
import { getLogger } from '../utils/logger.js'

export class OpenCodeServer {
  private process: ChildProcess | null = null
  private projectDir: string
  private port: number

  constructor(projectDir: string, port: number = 4097) {
    this.projectDir = projectDir
    this.port = port
  }

  private async checkPortAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          getLogger().warn(`Port ${this.port} is already in use`)
          resolve(false)
        } else {
          resolve(true)
        }
      })
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(this.port)
    })
  }

  private async waitForServer(maxAttempts: number = 30): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://localhost:${this.port}/session`, {
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok || response.status < 500) {
          return true
        }
      } catch {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    return false
  }

  async start(): Promise<void> {
    const log = getLogger()

    // Validate port range
    if (!Number.isInteger(this.port) || this.port < 1024 || this.port > 65535) {
      throw new Error(`Invalid port ${this.port}. Must be between 1024 and 65535.`)
    }

    // Check if port is available (cross-platform)
    const portAvailable = await this.checkPortAvailable()
    if (!portAvailable) {
      throw new Error(
        `Port ${this.port} is already in use. ` +
        `Either:\n` +
        `  1. Kill the process using port ${this.port}\n` +
        `  2. Use a different port: opencode-tele -p <port>\n` +
        `  3. Connect to existing server: opencode-tele --no-server`
      )
    }

    return new Promise((resolve, reject) => {
      // Check if opencode is installed
      const checkProcess = spawn('which', ['opencode'], { shell: true })

      checkProcess.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error('OpenCode is not installed. Install with: npm install -g opencode-ai'))
          return
        }

        // Start OpenCode server
        log.info('Spawning OpenCode server process...')

        this.process = spawn('opencode', ['serve', '--port', this.port.toString()], {
          cwd: this.projectDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        })

        let started = false
        let errorOutput = ''
        const timeout = setTimeout(() => {
          if (!started) {
            this.process?.kill()
            reject(new Error('OpenCode server failed to start within 30 seconds'))
          }
        }, 30000)

        this.process.stdout?.on('data', (data) => {
          const output = data.toString()
          log.info('OpenCode stdout', { output: output.trim() })

          if (output.includes('Server listening') || output.includes('started on port') || output.includes(this.port.toString())) {
            if (!started) {
              started = true
              clearTimeout(timeout)
              resolve()
            }
          }
        })

        this.process.stderr?.on('data', (data) => {
          const output = data.toString()
          errorOutput += output
          log.warn('OpenCode stderr', { output: output.trim() })
        })

        this.process.on('error', (error) => {
          clearTimeout(timeout)
          log.error('Failed to start OpenCode server', { error: error.message })
          reject(error)
        })

        this.process.on('close', (code) => {
          clearTimeout(timeout)
          if (!started) {
            const errorMsg = errorOutput.includes('Failed to start server on port')
              ? `Port ${this.port} is already in use. Use a different port with: opencode-tele -p <port>`
              : `OpenCode server exited with code ${code}. Error: ${errorOutput}`
            reject(new Error(errorMsg))
          } else {
            log.info('OpenCode server process exited', { code })
          }
        })

        // Wait for server to be ready by checking health endpoint
        setTimeout(async () => {
          if (!started) {
            const isReady = await this.waitForServer()
            if (isReady) {
              started = true
              clearTimeout(timeout)
              resolve()
            } else {
              // Server didn't respond, but might still be starting
              // Assume started after checking
              started = true
              clearTimeout(timeout)
              resolve()
            }
          }
        }, 3000)
      })
    })
  }

  async stop(): Promise<void> {
    const log = getLogger()

    if (this.process) {
      log.info('Stopping OpenCode server...')

      return new Promise((resolve) => {
        if (!this.process) {
          resolve()
          return
        }

        this.process.on('close', () => {
          log.info('OpenCode server stopped')
          resolve()
        })

        // Try graceful shutdown first
        this.process.kill('SIGTERM')

        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            log.warn('Force killing OpenCode server...')
            this.process.kill('SIGKILL')
          }
        }, 5000)
      })
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }
}
