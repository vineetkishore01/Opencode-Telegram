import { createWriteStream, WriteStream, mkdirSync } from 'fs'
import { dirname } from 'path'
import { BotConfig } from '../types/index.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class Logger {
  private logFile: WriteStream
  private logLevel: LogLevel
  private pendingWrites = 0
  private flushInterval: NodeJS.Timeout | null = null

  constructor(config: BotConfig) {
    const logDir = dirname(config.logFile)
    mkdirSync(logDir, { recursive: true })
    
    this.logFile = createWriteStream(config.logFile, { flags: 'a' })
    this.logFile.on('error', (err) => {
      console.error(`Failed to write to log file: ${err.message}`)
    })
    this.logLevel = config.logLevel

    // Periodic flush to ensure logs are written to disk
    this.flushInterval = setInterval(() => {
      if (this.pendingWrites > 0) {
        this.logFile.end()
        // Recreate stream after flush
        this.logFile = createWriteStream(config.logFile, { flags: 'a' })
        this.pendingWrites = 0
      }
    }, 5000)
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.logLevel]) {
      return
    }

    const timestamp = new Date().toISOString()
    let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`
    
    if (data) {
      const dataStr = JSON.stringify(data)
      // Truncate long data
      if (dataStr.length > 500) {
        logMessage += ` ${dataStr.substring(0, 500)}...`
      } else {
        logMessage += ` ${dataStr}`
      }
    }

    // Only log INFO and above to console (DEBUG goes to file only)
    if (level !== 'debug') {
      console.log(logMessage)
    }
    
    this.pendingWrites++
    this.logFile.write(logMessage + '\n')
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data)
  }

  info(message: string, data?: any): void {
    this.log('info', message, data)
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data)
  }

  error(message: string, data?: any): void {
    this.log('error', message, data)
  }

  close(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    this.logFile.end()
  }
}

let loggerInstance: Logger | null = null

export function getLogger(): Logger {
  if (!loggerInstance) {
    throw new Error('Logger not initialized')
  }
  return loggerInstance
}

export function initLogger(config: BotConfig): Logger {
  loggerInstance = new Logger(config)
  return loggerInstance
}
