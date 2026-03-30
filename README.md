# OpenCode Telegram Bot

A Telegram bot for remote development with [OpenCode](https://opencode.ai/). Code from anywhere using your phone.

## Installation

### Download Binary

Download from [GitHub Releases](https://github.com/vineetkishore01/Opencode-Telegram/releases):

**Linux:**
```bash
curl -L https://github.com/vineetkishore01/Opencode-Telegram/releases/latest/download/opencode-tele-linux-x64 -o opencode-tele
chmod +x opencode-tele
sudo mv opencode-tele /usr/local/bin/opencode-tele
```

**macOS:**
```bash
curl -L https://github.com/vineetkishore01/Opencode-Telegram/releases/latest/download/opencode-tele-macos-x64 -o opencode-tele
chmod +x opencode-tele
sudo mv opencode-tele /usr/local/bin/opencode-tele
```

**Windows:**
Download `opencode-tele-win-x64.exe` and add to PATH.

### From npm

```bash
npm install -g opencode-tele
```

## First Run

```bash
cd /your/project
opencode-tele
```

On first run, you'll be prompted for your Telegram bot token and user ID:

```
🤖 First time setup — configuring your Telegram bot credentials.

  To create a Telegram bot:
    1. Open Telegram and message @BotFather
    2. Send /newbot and follow the instructions
    3. Copy the bot token

Enter your Telegram bot token: 123456:ABC...

To get your user ID:
    1. Message @userinfobot on Telegram

Enter your Telegram user ID: 123456789

✅ Configuration saved! Starting bot...
```

Credentials are saved to `~/.opencode-tele/config.json` and never asked again.

## Prerequisites

- [OpenCode](https://opencode.ai/) installed: `npm install -g opencode-ai`

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/session` | Create new session |
| `/sessions` | List recent sessions |
| `/continue` | Pick a session interactively |
| `/status` | Show current session, model, cost |
| `/abort` | Stop a running task |
| `/clear` | Reset session/model/mode |
| `/providers` | List AI providers |
| `/models <provider>` | List models for a provider |
| `/model <provider> <name>` | Select a model |
| `/mode` | Show/set mode (build, plan, etc.) |
| `/modes` | List available modes |
| `/files [path]` | List files in directory |
| `/file <path>` | View file content |
| `/find <pattern>` | Search code |
| `/cost` | Show session cost tracking |
| `/todo` | Show AI task list |
| `/diff` | Show file changes |

Just send any message to prompt OpenCode. Multiple messages are queued automatically.

## CLI Options

```
  -d, --directory <path>  Project directory (default: current)
  -p, --port <port>       OpenCode server port (default: 4097)
  --no-server             Connect to existing OpenCode server
  --check                 Verify OpenCode installation
  --uninstall             Remove saved credentials
  -h, --help              Show help
```

## What it does

1. Starts OpenCode server in your project directory
2. Connects via REST API + Server-Sent Events
3. Forwards your Telegram messages as prompts to OpenCode
4. Streams back AI responses, tool outputs, file changes in real-time
5. Shows permission requests as inline buttons for approve/deny

## How it works

```
You (Telegram)  →  Telegram Bot  →  OpenCode Server
                                        ↓
                   Real-time ←  SSE Events  (thinking, tools, files, errors, permissions)
```

Events shown in Telegram:
- **Thinking** — AI reasoning shown as `🤔 Thinking: ...`
- **Tool execution** — bash, edit, write, read, grep with icons
- **File changes** — `📘 Edited: src/index.ts`
- **Permissions** — inline buttons: ✅ Once / 🔄 Always / ❌ Reject
- **Questions** — AI multi-choice questions, tap to answer
- **Costs** — tokens and cost after each response
- **Errors** — `⚠️ ErrorName: message`
- **Retries** — `🔄 Retry 2: timeout`
- **Todo lists** — `📋` with status icons
- **Compaction** — `📦 Context compacted` when context is summarized

## Project Files

The bot stores state directly in your project folder:
- `.opencode-tele-state.json` — session mappings, model selections, cost tracking
- `.opencode-tele.log` — logs

Both are git-ignored by default.

## Reconfigure

```bash
opencode-tele --uninstall   # Remove saved credentials
opencode-tele               # Re-run setup
```

## Development

```bash
git clone https://github.com/vineetkishore01/Opencode-Telegram.git
cd Opencode-Telegram/opencode-telegram-bot
npm install
npm run dev          # Watch mode
npm run build        # Compile to dist/
npm run build:binaries  # Build platform binaries
```

## License

MIT
