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

  constructor(config: BotConfig) {
    const logDir = dirname(config.logFile)
    mkdirSync(logDir, { recursive: true })
    
    this.logFile = createWriteStream(config.logFile, { flags: 'a' })
    this.logLevel = config.logLevel
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

    // Only log to console for warnings and errors
    if (level === 'warn' || level === 'error') {
      console.log(logMessage)
    }
    
    this.logFile.write(logMessage + '\n')
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data)
  }

  info(message: string, data?: any): void {
    // Only log important info messages
    if (message.includes('Starting') || 
        message.includes('started') || 
        message.includes('stopped') ||
        message.includes('Shutting') ||
        message.includes('Session') ||
        message.includes('Model') ||
        message.includes('Mode') ||
        message.includes('sent to OpenCode') ||
        message.includes('User message')) {
      this.log('info', message, data)
    } else {
      // Write to file but don't show in logic
      const timestamp = new Date().toISOString()
      this.logFile.write(`[${timestamp}] [INFO] ${message}\n`)
    }
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data)
  }

  error(message: string, data?: any): void {
    this.log('error', message, data)
  }

  close(): void {
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
