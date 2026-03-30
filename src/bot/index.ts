import { Bot } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'
import { StateManager } from '../state/manager.js'
import { OpenCodeClient } from '../opencode/client.js'
import { PermissionHandler } from '../opencode/permission.js'
import { EventProcessor } from '../opencode/events.js'
import { MessageQueue } from './queue.js'
import { registerCommands } from './commands.js'
import { registerHandlers } from './handlers.js'
import { BotConfig } from '../types/index.js'
import { getLogger } from '../utils/logger.js'

export class TelegramBot {
  private bot: Bot
  private stateManager: StateManager
  private openCodeClient: OpenCodeClient
  private permissionHandler: PermissionHandler
  private eventProcessor: EventProcessor
  private messageQueue: MessageQueue

  constructor(private config: BotConfig) {
    this.bot = new Bot(config.telegramToken)
    this.bot.api.config.use(autoRetry())

    this.stateManager = new StateManager(config.stateFile)
    this.messageQueue = new MessageQueue()

    const auth = config.openCodeUsername && config.openCodePassword
      ? { username: config.openCodeUsername, password: config.openCodePassword }
      : undefined

    this.openCodeClient = new OpenCodeClient(config.openCodeUrl, auth)
    this.permissionHandler = new PermissionHandler(this.openCodeClient, this.bot, this.stateManager)
    this.eventProcessor = new EventProcessor(this.openCodeClient, this.bot, this.stateManager, this.permissionHandler, this.messageQueue)

    this.setup()
  }

  private setup(): void {
    registerCommands(this.bot, this.stateManager, this.openCodeClient)
    registerHandlers(this.bot, this.stateManager, this.openCodeClient, this.permissionHandler, this.eventProcessor, this.messageQueue)
  }

  async start(): Promise<void> {
    const log = getLogger()

    // Load state
    await this.stateManager.load()

    // Start event processor in background
    this.eventProcessor.start().catch(error => {
      log.error('Event processor failed', { error: error.message })
    })

    // Start bot
    console.log('📡 Connecting to Telegram...')
    await this.bot.start({
      onStart: (info) => {
        const msg = `✅ Telegram bot started as @${info.username}`
        log.info(msg)
        console.log(msg)
      },
    })
  }

  async stop(): Promise<void> {
    const log = getLogger()

    // Stop event processor
    this.eventProcessor.stop()

    // Stop bot
    await this.bot.stop()

    // Save state
    await this.stateManager.save()

    log.info('Telegram bot stopped')
  }
}
