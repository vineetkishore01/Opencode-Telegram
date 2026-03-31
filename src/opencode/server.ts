import { spawn, ChildProcess } from 'child_process'
import { createServer } from 'net'
import { existsSync, accessSync, constants } from 'fs'
import { getLogger } from '../utils/logger.js'

const DEFAULT_PORT = 4097
const MAX_PORT_SEARCH = 10

export class OpenCodeServer {
  private process: ChildProcess | null = null
  private projectDir: string
  private port: number
  private starting = false

  constructor(projectDir: string, port: number = DEFAULT_PORT) {
    this.projectDir = projectDir
    this.port = port
  }

  getPort(): number {
    return this.port
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    // First, check if there's already an OpenCode server we can connect to
    for (let port = startPort; port < startPort + MAX_PORT_SEARCH; port++) {
      const existingServer = await this.checkOpenCodeServer(port)
      if (existingServer) {
        getLogger().info(`Found existing OpenCode server on port ${port}`)
        return port
      }
    }

    // No existing server found, try to find an available port to start new server
    for (let port = startPort; port < startPort + MAX_PORT_SEARCH; port++) {
      const available = await this.checkPort(port)
      if (available) {
        return port
      }
      getLogger().debug(`Port ${port} in use, trying next...`)
    }
    throw new Error(`No available ports found in range ${startPort}-${startPort + MAX_PORT_SEARCH - 1}`)
  }

  private async checkOpenCodeServer(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/session`, {
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false)
        } else {
          resolve(true)
        }
      })
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port)
    })
  }

  private async waitForServer(maxAttempts: number = 30): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/session`, {
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok) {
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

    if (this.process && !this.process.killed) {
      throw new Error('Server is already running')
    }

    if (this.starting) {
      throw new Error('Server is already starting')
    }
    this.starting = true

    try {
      if (!Number.isInteger(this.port) || this.port < 1024 || this.port > 65535) {
        throw new Error(`Invalid port ${this.port}. Must be between 1024 and 65535.`)
      }

      if (!existsSync(this.projectDir)) {
        throw new Error(`Project directory does not exist: ${this.projectDir}`)
      }
      try {
        accessSync(this.projectDir, constants.R_OK | constants.X_OK)
      } catch {
        throw new Error(`Project directory not accessible: ${this.projectDir}`)
      }

      // Try to find an available port, starting from requested port
      const actualPort = await this.findAvailablePort(this.port)
      if (actualPort !== this.port) {
        log.info(`Port ${this.port} in use, using port ${actualPort} instead`)
      }
      this.port = actualPort

      return new Promise((resolve, reject) => {
        log.info('Spawning OpenCode server process...', { port: this.port })

        this.process = spawn('opencode', ['serve', '--port', this.port.toString()], {
          cwd: this.projectDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        })

        const onExit = () => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL')
          }
        }
        process.once('exit', onExit)

        let started = false
        let errorOutput = ''
        const timeout = setTimeout(() => {
          if (!started) {
            this.process?.kill()
            this.starting = false
            reject(new Error('OpenCode server failed to start within 30 seconds'))
          }
        }, 30000)

        this.process.stdout?.on('data', (data) => {
          const output = data.toString()
          log.info('OpenCode stdout', { output: output.trim() })

          if (output.includes('Server listening') || output.includes('started on port')) {
            if (!started) {
              started = true
              clearTimeout(timeout)
              this.starting = false
              resolve()
            }
          }
        })

        this.process.stderr?.on('data', (data) => {
          const output = data.toString()
          errorOutput += output
          if (errorOutput.length > 10 * 1024) {
            errorOutput = errorOutput.slice(-10 * 1024)
          }
          log.warn('OpenCode stderr', { output: output.trim() })
        })

        this.process.on('error', (error) => {
          clearTimeout(timeout)
          this.starting = false
          log.error('Failed to start OpenCode server', { error: error.message })
          reject(error)
        })

        this.process.on('close', (code) => {
          clearTimeout(timeout)
          if (!started) {
            this.starting = false
            const errorMsg = errorOutput.includes('Failed to start server on port')
              ? `Port ${this.port} is already in use. Use a different port with: opencode-tele -p <port>`
              : `OpenCode server exited with code ${code}. Error: ${errorOutput}`
            reject(new Error(errorMsg))
          } else {
            this.process = null
            const msg = `⚠️ OpenCode server process exited with code ${code}`
            log.warn(msg)
            console.warn(`\n${msg}`)
          }
        })

        setTimeout(async () => {
          if (!started) {
            const isReady = await this.waitForServer()
            if (isReady) {
              started = true
              clearTimeout(timeout)
              this.starting = false
              resolve()
            } else {
              this.process?.kill()
              this.starting = false
              reject(new Error('OpenCode server failed health check'))
            }
          }
        }, 3000)
      })
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    const log = getLogger()

    if (!this.process || this.process.killed) {
      this.process = null
      return
    }

    return new Promise((resolve) => {
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
