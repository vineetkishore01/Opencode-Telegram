# OpenCode Telegram Bot

Remote development with [OpenCode](https://opencode.ai/) via Telegram. Code from your phone.

## Install

### macOS / Linux

```bash
# Download
curl -L https://github.com/vineetkishore01/Opencode-Telegram/releases/latest/download/opencode-tele-macos-x64 -o opencode-tele

# Make executable
chmod +x opencode-tele

# Move to PATH
sudo mv opencode-tele /usr/local/bin/opencode-tele
```

### Windows

Download `opencode-tele-win-x64.exe` from [Releases](https://github.com/vineetkishore01/Opencode-Telegram/releases), rename to `opencode-tele.exe`, add to PATH.

### npm

```bash
npm install -g opencode-tele
```

## Prerequisites

```bash
npm install -g opencode-ai
```

## Usage

```bash
cd /your/project
opencode-tele
```

First run in each project asks for:
- **Telegram bot token** — create via [@BotFather](https://t.me/BotFather)
- **Your user ID** — get from [@userinfobot](https://t.me/userinfobot)

Credentials saved to `<project>/.opencode-tele/config.json`. Next runs pick up automatically.

## Per-Project Config

Each project gets its own `.opencode-tele/` folder:

```
your-project/
└── .opencode-tele/
    ├── config.json    # Bot token, user ID
    ├── state.json     # Sessions, model selections, costs
    └── bot.log        # Logs
```

Different projects = different bots, different chats, different models.

## Commands

| Command | Description |
|---------|-------------|
| `/session` | Create new session |
| `/sessions` | List recent sessions |
| `/continue` | Pick a session interactively |
| `/status` | Show current session, model, cost |
| `/abort` | Stop running task |
| `/clear` | Reset session/model/mode |
| `/providers` | List AI providers |
| `/models <provider>` | List models for provider |
| `/model <provider> <name>` | Select model |
| `/mode` | Show/set mode (build, plan, etc.) |
| `/modes` | List available modes |
| `/files [path]` | List files in directory |
| `/file <path>` | View file content |
| `/find <pattern>` | Search code |
| `/cost` | Show cost tracking |
| `/todo` | Show AI task list |
| `/diff` | Show file changes |

Just send any message to prompt OpenCode. Multiple messages are queued automatically.

## CLI Options

```
  -d, --directory <path>  Project directory (default: current)
  -p, --port <port>       OpenCode server port (default: 4097)
  --no-server             Connect to existing OpenCode server
  --check                 Verify OpenCode installation and project config
  --uninstall             Remove this project's configuration
  -h, --help              Show help
```

## Reconfigure

```bash
opencode-tele --uninstall   # Remove this project's config
opencode-tele               # Re-run setup for this project
```

## What You Get in Telegram

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

## How It Works

```
You (Telegram) → Telegram Bot → OpenCode Server
                                      ↓
                 Real-time ← SSE Events
```

## License

MIT
