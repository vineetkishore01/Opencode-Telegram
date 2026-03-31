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
  private authorizedUserId: string

  constructor(private config: BotConfig) {
    this.bot = new Bot(config.telegramToken)
    this.bot.api.config.use(autoRetry())

    this.stateManager = new StateManager(config.stateFile)

    const auth = config.openCodeUsername && config.openCodePassword
      ? { username: config.openCodeUsername, password: config.openCodePassword }
      : undefined

    this.openCodeClient = new OpenCodeClient(config.openCodeUrl, auth)
    this.messageQueue = new MessageQueue(this.stateManager)
    this.permissionHandler = new PermissionHandler(this.openCodeClient, this.bot, this.stateManager)
    this.eventProcessor = new EventProcessor(this.openCodeClient, this.bot, this.stateManager, this.permissionHandler, this.messageQueue)
    this.authorizedUserId = config.authorizedUserId

    this.setup()
  }

  private setup(): void {
    registerCommands(this.bot, this.stateManager, this.openCodeClient, this.messageQueue, this.authorizedUserId)
    registerHandlers(this.bot, this.stateManager, this.openCodeClient, this.permissionHandler, this.eventProcessor, this.messageQueue, this.authorizedUserId)
  }

  async start(): Promise<void> {
    const log = getLogger()

    // Load state
    await this.stateManager.load()

    // Restore persisted queue
    this.messageQueue.loadPersisted()

    // Start event processor in background
    this.eventProcessor.start().catch(error => {
      log.error('Event processor failed', { error: error.message })
    })

    // Start bot
    console.log('📡 Connecting to Telegram...')
    await this.bot.start({
      onStart: async (info) => {
        const msg = `✅ Telegram bot started as @${info.username}`
        log.info(msg)
        console.log(msg)
        
        // Send startup notification to authorized user
        try {
          await this.bot.api.sendMessage(this.authorizedUserId, '🚀 OpenCode is Online 🔥')
        } catch (e) {
          log.warn('Failed to send startup message', { error: (e as Error).message })
        }
      },
    })
  }

  async stop(): Promise<void> {
    const log = getLogger()

    // Send shutdown notification to authorized user
    try {
      await this.bot.api.sendMessage(this.authorizedUserId, '🔴 OpenCode is going down 🔥')
    } catch (e) {
      log.warn('Failed to send shutdown message', { error: (e as Error).message })
    }

    // Stop event processor
    this.eventProcessor.stop()

    // Stop bot
    await this.bot.stop()

    // Save state
    await this.stateManager.save()

    log.info('Telegram bot stopped')
  }
}
