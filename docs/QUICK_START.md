# Quick Start Guide

## 1. Install the Bot

```bash
cd "/Users/vineetkishore/Code/Opencode Telegram/opencode-telegram-bot"
npm install
npm run build
npm install -g .
```

## 2. Create Telegram Bot

1. Open Telegram
2. Message [@BotFather](https://t.me/BotFather)
3. Send `/newbot`
4. Choose a name: `OpenCode Bot`
5. Choose a username: `opencode_bot` (must end in `bot`)
6. Copy the bot token (looks like: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)

## 3. Get Your User ID

1. Open Telegram
2. Message [@userinfobot](https://t.me/userinfobot)
3. It will reply with your user ID (looks like: `123456789`)

## 4. Create `.env` File

Navigate to your project directory and create a `.env` file:

```bash
# Go to your project
cd /path/to/your/project

# Create .env file
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your_bot_token_here
AUTHORIZED_USER_ID=your_user_id_here
EOF
```

**Example:**
```bash
cat > .env << EOF
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
AUTHORIZED_USER_ID=123456789
EOF
```

## 5. Start the Bot

```bash
# Navigate to your project directory
cd /path/to/your/project

# Start the bot
opencode-tele
```

The bot will:
1. Start OpenCode server in your project directory
2. Start the Telegram bot
3. Wait for you to send commands via Telegram

## 6. Use Telegram

1. **Open Telegram** on your phone or computer
2. **Find your bot** (search for the username you created)
3. **Send `/start`** to see commands
4. **Send `/session`** to create a new session
5. **Send any message** to prompt OpenCode

## Example Workflow

```bash
# Terminal 1: Start the bot
cd /path/to/my-project
opencode-tele

# Output:
# [2024-03-30T03:15:00.000Z] [INFO] Starting OpenCode Telegram Bot...
# [2024-03-30T03:15:00.000Z] [INFO] Project directory { directory: '/path/to/my-project' }
# [2024-03-30T03:15:00.000Z] [INFO] Port { port: 4096 }
# [2024-03-30T03:15:01.000Z] [INFO] Starting OpenCode server...
# [2024-03-30T03:15:03.000Z] [INFO] OpenCode server started successfully
# [2024-03-30T03:15:03.000Z] [INFO] Starting Telegram bot...
# [2024-03-30T03:15:04.000Z] [INFO] Telegram bot started
```

Now use Telegram on your phone:

1. **Send `/start`** → Bot shows welcome message
2. **Send `/session`** → Bot creates a new session
3. **Send "Create a function to validate email"** → Bot sends to OpenCode
4. **Receive updates** as OpenCode works
5. **If permission needed** → Bot shows buttons to approve/deny

## How Permissions Work

When OpenCode needs permission (e.g., to edit a file), you'll see:

```
*Permission Request*

Permission: `edit`
Patterns: `src/**/*.ts`

How would you like to respond?

[✅ Once] [🔄 Always] [❌ Reject]
```

- **Tap "✅ Once"** → Allow this action
- **Tap "🔄 Always"** → Always allow this type
- **Tap "❌ Reject"** → Deny the action

## Stopping the Bot

Press `Ctrl+C` in the terminal where the bot is running.

## Troubleshooting

### "OpenCode is not installed"
```bash
npm install -g opencode-ai
```

### Bot not responding
1. Check your `.env` file has correct values
2. Check bot logs: `tail -f bot.log`
3. Restart the bot

### Cannot connect to OpenCode
1. Make sure you're in the right directory
2. Check if OpenCode is installed: `which opencode`
3. Try different port: `opencode-tele -p 5000`

## Advanced Usage

### Start in different directory
```bash
opencode-tele -d /path/to/other/project
```

### Use different port
```bash
opencode-tele -p 5000
```

### Connect to existing OpenCode server
```bash
# Start OpenCode manually in one terminal
opencode serve --port 4096

# In another terminal, connect bot
opencode-tele --no-server
```

## What You Can Do

- ✅ Send prompts to OpenCode from anywhere
- ✅ Receive thinking/assessment updates
- ✅ Approve/deny permissions remotely
- ✅ See file changes in real-time
- ✅ Monitor terminal output
- ✅ Switch between sessions
- ✅ Work on multiple projects

## Next Steps

1. **Try sending a prompt** via Telegram
2. **Watch the real-time updates**
3. **Test permission handling**
4. **Explore different commands**

Enjoy remote development with OpenCode! 🚀
