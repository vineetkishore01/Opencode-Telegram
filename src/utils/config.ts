import { BotConfig } from '../types/index.js'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, readdirSync } from 'fs'

const GLOBAL_CONFIG_DIR = join(homedir(), '.opencode-tele')
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json')

export interface GlobalConfig {
  telegramToken: string
  authorizedUserId: string
}

export function loadGlobalConfig(): GlobalConfig | null {
  try {
    if (existsSync(GLOBAL_CONFIG_FILE)) {
      const data = readFileSync(GLOBAL_CONFIG_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    // Config doesn't exist or is invalid
  }
  return null
}

export function saveGlobalConfig(config: GlobalConfig): void {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function globalConfigExists(): boolean {
  return existsSync(GLOBAL_CONFIG_FILE)
}

export function hasCredentials(): boolean {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.AUTHORIZED_USER_ID) return true
  const global = loadGlobalConfig()
  return !!(global?.telegramToken && global?.authorizedUserId)
}

export function removeGlobalConfig(): boolean {
  try {
    if (existsSync(GLOBAL_CONFIG_FILE)) {
      unlinkSync(GLOBAL_CONFIG_FILE)
    }
    if (existsSync(GLOBAL_CONFIG_DIR) && readdirSync(GLOBAL_CONFIG_DIR).length === 0) {
      rmdirSync(GLOBAL_CONFIG_DIR)
    }
    return true
  } catch {
    return false
  }
}

export function loadConfig(projectDir: string): BotConfig {
  const stateFile = join(projectDir, '.opencode-tele-state.json')
  const logFile = join(projectDir, '.opencode-tele.log')

  const globalConfig = loadGlobalConfig()

  return {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || globalConfig?.telegramToken || '',
    authorizedUserId: process.env.AUTHORIZED_USER_ID || globalConfig?.authorizedUserId || '',
    openCodeUrl: process.env.OPENCODE_SERVER_URL || 'http://localhost:4097',
    openCodeUsername: process.env.OPENCODE_SERVER_USERNAME,
    openCodePassword: process.env.OPENCODE_SERVER_PASSWORD,
    stateFile,
    logFile,
    logLevel: (process.env.LOG_LEVEL as BotConfig['logLevel']) || 'info',
  }
}

export function validateConfig(config: BotConfig): void {
  if (!config.telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required.')
  }

  if (!config.authorizedUserId) {
    throw new Error('AUTHORIZED_USER_ID is required.')
  }

  if (!config.openCodeUrl) {
    throw new Error('OPENCODE_SERVER_URL is required')
  }
}
