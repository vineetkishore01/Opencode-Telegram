#!/usr/bin/env node
import { config } from 'dotenv'
import { parseArgs } from 'util'
import { resolve } from 'path'
import { TelegramBot } from './bot/index.js'
import { OpenCodeServer } from './opencode/server.js'
import { loadConfig, validateConfig, hasCredentials, saveProjectConfig, removeProjectConfig, projectConfigExists } from './utils/config.js'
import { initLogger, getLogger } from './utils/logger.js'

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
    tunnel: {
      type: 'boolean',
      description: 'Enable Cloudflare tunnel (default: disabled, local-only)',
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
  --no-server             Don't start OpenCode, connect to existing server
  --tunnel                Enable Cloudflare tunnel (default: disabled, local-only)
  --uninstall             Remove project configuration
  -h, --help              Show this help

Examples:
  opencode-tele                      # Start OpenCode + bot (local-only, no tunnel)
  opencode-tele -d /path/to/project  # Start in specific directory
  opencode-tele -p 5000              # Use different port
  opencode-tele --tunnel             # Enable Cloudflare tunnel for remote access
  opencode-tele --no-server          # Connect to existing OpenCode server
  opencode-tele --uninstall          # Remove this project's config

Security: By default, the bot runs in local-only mode with no remote exposure.
Use --tunnel only if you need remote access and understand the security implications.
`)
  process.exit(0)
}

async function runSetup(projectDir: string): Promise<boolean> {
  console.log('\n🤖 First time in this project — setup your Telegram bot.\n')
  console.log('To create a Telegram bot:')
  console.log('  1. Open Telegram and message @BotFather')
  console.log('  2. Send /newbot and follow the instructions')
  console.log('  3. Copy the bot token\n')

  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const promptInput = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim())
      })
    })
  }

  const telegramToken = await promptInput('Enter your Telegram bot token: ')

  if (!telegramToken) {
    console.error('❌ Bot token is required.')
    rl.close()
    return false
  }

  console.log('\nTo get your user ID:')
  console.log('  1. Message @userinfobot on Telegram')
  console.log('  2. It will reply with your user ID\n')

  const authorizedUserId = await promptInput('Enter your Telegram user ID: ')

  if (!authorizedUserId) {
    console.error('❌ User ID is required.')
    rl.close()
    return false
  }

  rl.close()

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
  const startServer = !values['no-server']

  // Handle --uninstall
  if (values.uninstall) {
    let uninstalled = false
    if (projectConfigExists(projectDir)) {
      removeProjectConfig(projectDir)
      console.log('✅ Project configuration directory removed: .opencode-tele/')
      uninstalled = true
    }

    const binaryPath = '/usr/local/bin/opencode-tele'
    if (require('fs').existsSync(binaryPath)) {
      console.log(`\nTo completely remove the global binary, run:\n  sudo rm -f ${binaryPath}`)
      uninstalled = true
    }

    if (!uninstalled) {
      console.log('✨ Your system is already clean of OpenCode Telegram Bot configs and binaries.')
    } else {
      console.log('\n🧹 System cleanup instructions/actions provided above.')
    }
    process.exit(0)
  }

  // Auto-detect: if no credentials found for this project, run setup inline
  if (!hasCredentials(projectDir)) {
    const success = await runSetup(projectDir)
    if (!success) {
      process.exit(1)
    }
  }

  // Load and validate configuration
  const botConfig = loadConfig(projectDir)
  validateConfig(botConfig)

  // Set OpenCode URL
  botConfig.openCodeUrl = `http://127.0.0.1:${values.port}`

  // Initialize logger
  const logger = initLogger(botConfig)
  logger.info('Starting OpenCode Telegram Bot...')
  logger.info('Project directory', { directory: projectDir })

  let openCodeServer: OpenCodeServer | null = null

  // Start OpenCode server if requested
  if (startServer) {
    console.log('⏳ Starting OpenCode server...')
    const serverPort = parseInt(values.port || '4097', 10)
    const enableTunnel = !!values.tunnel
    
    if (enableTunnel) {
      console.log('⚠️  Cloudflare tunnel enabled - server will be publicly accessible')
    } else {
      console.log('🔒 Local-only mode - no remote access')
    }
    
    openCodeServer = new OpenCodeServer(projectDir, serverPort)

    try {
      await openCodeServer.start(enableTunnel)
      const actualPort = openCodeServer.getPort()
      console.log(`✅ OpenCode server started on port ${actualPort}`)
      botConfig.openCodeUrl = `http://127.0.0.1:${actualPort}`
    } catch (error) {
      console.error(`❌ Failed to start OpenCode server: ${(error as Error).message}`)
      logger.error('Failed to start OpenCode server', { error: (error as Error).message })
      process.exit(1)
    }
  }

  // Create and start bot
  console.log('🚀 Starting Telegram bot...')
  console.log(`📡 Connecting to OpenCode at ${botConfig.openCodeUrl}`)
  const bot = new TelegramBot(botConfig, openCodeServer)

  // Handle graceful shutdown
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Shutting down...')

    console.log('\n🔴 Stopping services...')

    // Stop OpenCode server first
    if (openCodeServer) {
      await openCodeServer.stop()
    }

    // Stop bot (sends shutdown notification)
    await bot.stop()

    logger.close()
    
    console.log('✅ Goodbye!')
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
