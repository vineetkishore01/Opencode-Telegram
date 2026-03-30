import { config } from 'dotenv'
import { parseArgs } from 'util'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { createInterface } from 'readline'
import { TelegramBot } from './bot/index.js'
import { loadConfig, validateConfig, hasCredentials, saveProjectConfig, removeProjectConfig, projectConfigExists } from './utils/config.js'
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
    },
    port: {
      type: 'string',
      short: 'p',
    },
    'no-server': {
      type: 'boolean',
    },
    check: {
      type: 'boolean',
    },
    uninstall: {
      type: 'boolean',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
  allowPositionals: true,
})

// Set defaults after parseArgs
const directory = values.directory || process.cwd()
const port = values.port || '4097'

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
  --uninstall             Remove project configuration
  -h, --help              Show this help

Examples:
  opencode-tele                      # Start in current directory
  opencode-tele -d /path/to/project  # Start in specific directory
  opencode-tele -p 5000              # Use different port
  opencode-tele --no-server          # Connect to existing server
  opencode-tele --check              # Verify OpenCode is installed
  opencode-tele --uninstall          # Remove this project's config
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

async function runSetup(projectDir: string): Promise<boolean> {
  console.log('\n🤖 First time in this project — setup your Telegram bot.\n')
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

  saveProjectConfig(projectDir, {
    telegramToken,
    authorizedUserId,
  })

  console.log('\n✅ Configuration saved to .opencode-tele/config.json')
  console.log('   Starting bot...\n')
  return true
}

async function main() {
  const projectDir = resolve(directory)

  // Validate project directory
  if (!existsSync(projectDir)) {
    console.error(`Error: Directory does not exist: ${projectDir}`)
    process.exit(1)
  }

  // Handle --check
  if (values.check) {
    if (!checkOpenCode()) {
      console.log('\n❌ OpenCode is not installed.')
      console.log('\nInstall with:')
      console.log('  npm install -g opencode-ai\n')
      process.exit(1)
    }
    console.log('✅ OpenCode is installed and ready.')
    if (projectConfigExists(projectDir)) {
      console.log('✅ Project configuration found.')
    } else {
      console.log('ℹ️  No project configuration yet (will prompt on first run).')
    }
    process.exit(0)
  }

  // Handle --uninstall
  if (values.uninstall) {
    let uninstalled = false
    if (projectConfigExists(projectDir)) {
      removeProjectConfig(projectDir)
      console.log('✅ Project configuration removed (.opencode-tele)')
      uninstalled = true
    }

    const binaryPath = '/usr/local/bin/opencode-tele'
    if (existsSync(binaryPath)) {
      console.log(`\nTo completely remove the global binary, run:\n  sudo rm ${binaryPath}\n`)
      uninstalled = true
    }

    if (!uninstalled) {
      console.log('No project configuration or global binary found.')
    } else {
      console.log('Done.')
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

  // Auto-detect: if no credentials found for this project, run setup inline
  if (!hasCredentials(projectDir)) {
    const success = await runSetup(projectDir)
    if (!success) {
      process.exit(1)
    }
  }

  const portNum = parseInt(port, 10)
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
    console.log('⏳ Starting OpenCode server...')
    openCodeServer = new OpenCodeServer(projectDir, portNum)

    try {
      await openCodeServer.start()
      console.log('✅ OpenCode server started')
      botConfig.openCodeUrl = `http://127.0.0.1:${portNum}`
    } catch (error) {
      console.error(`❌ Failed to start OpenCode server: ${(error as Error).message}`)
      process.exit(1)
    }
  }

  // Create and start bot
  console.log('🚀 Starting Telegram bot...')
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
