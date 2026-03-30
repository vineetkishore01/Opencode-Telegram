import { config } from 'dotenv'
import { parseArgs } from 'util'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { createInterface } from 'readline'
import { TelegramBot } from './bot/index.js'
import { loadConfig, validateConfig, hasCredentials, saveGlobalConfig, removeGlobalConfig } from './utils/config.js'
import { initLogger, getLogger } from './utils/logger.js'
import { OpenCodeServer } from './opencode/server.js'

// Load environment variables
config()

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    directory: {
      type: 'string',
      short: 'd',
      default: process.cwd(),
    },
    port: {
      type: 'string',
      short: 'p',
      default: '4097',
    },
    'no-server': {
      type: 'boolean',
      default: false,
    },
    check: {
      type: 'boolean',
      default: false,
    },
    uninstall: {
      type: 'boolean',
      default: false,
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(`
opencode-tele - OpenCode Telegram Bot

Usage:
  opencode-tele [options]

Options:
  -d, --directory <path>  Project directory (default: current directory)
  -p, --port <port>       OpenCode server port (default: 4097)
  --no-server             Don't start OpenCode server (connect to existing)
  --check                 Verify OpenCode installation
  --uninstall             Remove saved credentials
  -h, --help              Show this help

Examples:
  opencode-tele                      # Start in current directory
  opencode-tele -d /path/to/project  # Start in specific directory
  opencode-tele -p 5000              # Use different port
  opencode-tele --no-server          # Connect to existing server
  opencode-tele --check              # Verify OpenCode is installed
  opencode-tele --uninstall          # Remove saved credentials
`)
  process.exit(0)
}

function checkOpenCode(): boolean {
  try {
    const result = spawnSync('opencode', ['--version'], { stdio: 'pipe' })
    return result.status === 0
  } catch {
    return false
  }
}

async function promptInput(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function runSetup(): Promise<boolean> {
  console.log('\n🤖 First time setup — configuring your Telegram bot credentials.\n')
  console.log('To create a Telegram bot:')
  console.log('  1. Open Telegram and message @BotFather')
  console.log('  2. Send /newbot and follow the instructions')
  console.log('  3. Copy the bot token\n')

  const telegramToken = await promptInput('Enter your Telegram bot token: ')

  if (!telegramToken) {
    console.error('❌ Bot token is required.')
    return false
  }

  console.log('\nTo get your user ID:')
  console.log('  1. Message @userinfobot on Telegram')
  console.log('  2. It will reply with your user ID\n')

  const authorizedUserId = await promptInput('Enter your Telegram user ID: ')

  if (!authorizedUserId) {
    console.error('❌ User ID is required.')
    return false
  }

  saveGlobalConfig({
    telegramToken,
    authorizedUserId,
  })

  console.log('\n✅ Configuration saved! Starting bot...\n')
  return true
}

async function main() {
  // Handle --check
  if (values.check) {
    if (!checkOpenCode()) {
      console.log('\n❌ OpenCode is not installed.')
      console.log('\nInstall with:')
      console.log('  npm install -g opencode-ai\n')
      process.exit(1)
    }
    console.log('✅ OpenCode is installed and ready.')
    process.exit(0)
  }

  // Handle --uninstall
  if (values.uninstall) {
    if (removeGlobalConfig()) {
      console.log('✅ Configuration removed.')
    } else {
      console.log('No configuration found.')
    }
    process.exit(0)
  }

  // Check OpenCode is installed
  if (!checkOpenCode()) {
    console.error('\n❌ OpenCode is not installed.')
    console.error('\nInstall with:')
    console.error('  npm install -g opencode-ai\n')
    process.exit(1)
  }

  const projectDir = resolve(values.directory as string)

  // Validate project directory
  if (!existsSync(projectDir)) {
    console.error(`Error: Directory does not exist: ${projectDir}`)
    process.exit(1)
  }

  // Auto-detect: if no credentials found, run setup inline
  if (!hasCredentials()) {
    const success = await runSetup()
    if (!success) {
      process.exit(1)
    }
  }

  const port = parseInt(values.port as string, 10)
  const startServer = !values['no-server']

  // Load and validate configuration
  const botConfig = loadConfig(projectDir)
  validateConfig(botConfig)

  // Initialize logger
  const logger = initLogger(botConfig)
  logger.info('Starting OpenCode Telegram Bot...')
  logger.info('Project directory', { directory: projectDir })

  let openCodeServer: OpenCodeServer | null = null

  // Start OpenCode server if needed
  if (startServer) {
    logger.info('Starting OpenCode server...')
    openCodeServer = new OpenCodeServer(projectDir, port)

    try {
      await openCodeServer.start()
      logger.info('OpenCode server started')

      // Update config with actual port
      botConfig.openCodeUrl = `http://localhost:${port}`
    } catch (error) {
      logger.error('Failed to start OpenCode server', { error: (error as Error).message })
      process.exit(1)
    }
  }

  // Create and start bot
  const bot = new TelegramBot(botConfig)

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...')

    if (openCodeServer) {
      await openCodeServer.stop()
    }

    await bot.stop()
    logger.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await bot.start()
  } catch (error) {
    logger.error('Failed to start bot', { error: (error as Error).message })

    if (openCodeServer) {
      await openCodeServer.stop()
    }

    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
