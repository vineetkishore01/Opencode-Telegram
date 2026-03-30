import { BotConfig } from '../types/index.js'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'

const PROJECT_CONFIG_DIR = '.opencode-tele'
const PROJECT_CONFIG_FILE = 'config.json'
const PROJECT_STATE_FILE = 'state.json'
const PROJECT_LOG_FILE = 'bot.log'

export interface ProjectConfig {
  telegramToken: string
  authorizedUserId: string
  openCodeUrl?: string
  openCodeUsername?: string
  openCodePassword?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

export function getProjectConfigDir(projectDir: string): string {
  return join(projectDir, PROJECT_CONFIG_DIR)
}

export function getProjectConfigPath(projectDir: string): string {
  return join(projectDir, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE)
}

export function getProjectStatePath(projectDir: string): string {
  return join(projectDir, PROJECT_CONFIG_DIR, PROJECT_STATE_FILE)
}

export function getProjectLogPath(projectDir: string): string {
  return join(projectDir, PROJECT_CONFIG_DIR, PROJECT_LOG_FILE)
}

export function projectConfigExists(projectDir: string): boolean {
  return existsSync(getProjectConfigDir(projectDir))
}

export function loadProjectConfig(projectDir: string): ProjectConfig | null {
  try {
    const configPath = getProjectConfigPath(projectDir)
    if (existsSync(configPath)) {
      const data = readFileSync(configPath, 'utf-8')
      return JSON.parse(data)
    }
  } catch {
    // Config doesn't exist or is invalid
  }
  return null
}

export function saveProjectConfig(projectDir: string, config: ProjectConfig): void {
  const configDir = getProjectConfigDir(projectDir)
  mkdirSync(configDir, { recursive: true })
  writeFileSync(getProjectConfigPath(projectDir), JSON.stringify(config, null, 2))
}

export function removeProjectConfig(projectDir: string): boolean {
  try {
    const configDir = getProjectConfigDir(projectDir)
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true })
    }
    return true
  } catch {
    return false
  }
}

export function hasCredentials(projectDir: string): boolean {
  // Check env vars first
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.AUTHORIZED_USER_ID) return true
  // Then check project config
  const config = loadProjectConfig(projectDir)
  return !!(config?.telegramToken && config?.authorizedUserId)
}

export function loadConfig(projectDir: string): BotConfig {
  const projectConfig = loadProjectConfig(projectDir)

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN || projectConfig?.telegramToken || ''
  const authorizedUserId = process.env.AUTHORIZED_USER_ID || projectConfig?.authorizedUserId || ''

  // Ensure env vars are set if they were loaded from config file
  // This is important because handlers/commands use these env vars
  if (!process.env.TELEGRAM_BOT_TOKEN && telegramToken) {
    process.env.TELEGRAM_BOT_TOKEN = telegramToken
  }
  if (!process.env.AUTHORIZED_USER_ID && authorizedUserId) {
    process.env.AUTHORIZED_USER_ID = authorizedUserId
  }

  return {
    telegramToken,
    authorizedUserId,
    openCodeUrl: process.env.OPENCODE_SERVER_URL || projectConfig?.openCodeUrl || 'http://127.0.0.1:4097',
    openCodeUsername: process.env.OPENCODE_SERVER_USERNAME || projectConfig?.openCodeUsername,
    openCodePassword: process.env.OPENCODE_SERVER_PASSWORD || projectConfig?.openCodePassword,
    stateFile: resolve(getProjectStatePath(projectDir)),
    logFile: resolve(getProjectLogPath(projectDir)),
    logLevel: (process.env.LOG_LEVEL as BotConfig['logLevel']) || projectConfig?.logLevel || 'info',
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
