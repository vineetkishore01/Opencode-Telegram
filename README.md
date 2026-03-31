# OpenCode Telegram Bot

Control your [OpenCode](https://github.com/opencode-ai/opencode) server from anywhere using Telegram. This bot allows you to prompt OpenCode, manage sessions, browse files, approve permissions, and monitor task execution directly from your phone or desktop.

## ✨ Features

- **Remote Control**: Send prompts to OpenCode from Telegram
- **Session Management**: Create, list, switch between sessions
- **Real-time Updates**: Receive live notifications for:
  - Reasoning/thinking process
  - Tool execution (bash, edit, write, read, etc.)
  - File edits and patches
  - Task completion
  - Token usage and costs
- **Permission Handling**: Approve/reject file access and tool execution requests
- **Message Queueing**: Automatically queues multiple prompts when busy
- **Model/Mode Selection**: Choose AI providers, models, and modes (build/plan/review/debug)
- **File Operations**: List files, view content, search code
- **Parallel Projects**: Run multiple instances on different projects with auto port selection

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [OpenCode](https://github.com/opencode-ai/opencode) installed globally (`npm install -g opencode-ai`)
- A Telegram account

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/vineetkishore01/Opencode-Telegram.git
cd Opencode-Telegram

# Install dependencies
npm install

# Build TypeScript
npm run build

# Install globally (may need sudo)
sudo npm install -g .
```

### 3. First Run Setup

Navigate to any project directory and run:

```bash
opencode-tele
```

The bot will guide you through setting up:

1. **Telegram Bot Token**: Get from [@BotFather](https://t.me/botfather)
   - Send `/newbot` to BotFather
   - Follow instructions to create a bot
   - Copy the token

2. **Your User ID**: Get from [@userinfobot](https://t.me/userinfobot)
   - Message @userinfobot on Telegram
   - It will reply with your numeric user ID

### 4. Verify Installation

```bash
opencode-tele --check
```

## 📖 Usage

### Basic Commands

```bash
opencode-tele                      # Start in current directory
opencode-tele -d /path/to/project  # Start in specific directory
opencode-tele -p 5000              # Use specific port
opencode-tele --no-server          # Connect to existing server
```

### Command-Line Options

| Option | Description |
|--------|-------------|
| `-d, --directory <path>` | Project directory (default: current directory) |
| `-p, --port <port>` | OpenCode server port (default: 4097, auto-selects if busy) |
| `--no-server` | Don't start OpenCode server, connect to existing |
| `--check` | Verify OpenCode installation |
| `--uninstall` | Remove project configuration |
| `-h, --help` | Show help |

## 📱 Telegram Commands

### Session Commands

| Command | Description |
|---------|-------------|
| `/session` | Create a new OpenCode session |
| `/session <id>` | Select existing session by ID |
| `/sessions` | List 10 most recent sessions |
| `/continue` | Continue an old session (interactive) |
| `/status` | Show current session, model, and mode |
| `/abort` | Stop the currently running task |
| `/clear` | Clear current session, model, and mode |

### Model Commands

| Command | Description |
|---------|-------------|
| `/providers` | List available AI providers |
| `/models <provider>` | List models for a specific provider |
| `/model` | Show current model |
| `/model <provider> <model>` | Select a specific model |

### Mode Commands

| Command | Description |
|---------|-------------|
| `/mode` | Show current mode |
| `/mode <name>` | Select mode (build/plan/review/debug) |
| `/modes` | List available modes |

### File Commands

| Command | Description |
|---------|-------------|
| `/files` | List files in current directory |
| `/files <path>` | List files in specific directory |
| `/file <path>` | View file content |
| `/find <pattern>` | Search code in project |

### Info Commands

| Command | Description |
|---------|-------------|
| `/cost` | Show token usage and cost for session |
| `/todo` | Show task list |
| `/diff` | Show file changes |
| `/help` | Show all available commands |

### Using the Bot

1. **Start a session**: Send `/session` to create a new session
2. **Send a prompt**: Just type any message to prompt OpenCode
3. **Multiple messages**: If busy, messages are automatically queued

## 🔧 How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│   Telegram Bot    │────▶│  OpenCode API   │
│   User          │◀────│   (grammy)        │◀────│  (localhost)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Event Processor  │
                        │ (Polling Loop)   │
                        └──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌───────────┐   ┌─────────────┐
        │Permission│    │  Message  │   │   Session   │
        │ Handler  │    │   Queue   │   │   Status    │
        └──────────┘    └───────────┘   └─────────────┘
```

### Components

1. **Telegram Bot (grammy)**: Handles incoming messages and commands
2. **OpenCode Client**: HTTP client to communicate with OpenCode server
3. **Event Processor**: Polls OpenCode for updates (reasoning, tools, completion)
4. **Message Queue**: Queues messages when OpenCode is busy
5. **Permission Handler**: Manages file/tool permission requests

### Port Management

The bot automatically handles port conflicts:
- If port 4097 is busy, it checks for existing OpenCode server
- If none found, it tries ports 4098, 4099, etc. (up to 10 ports)
- Each project can run on its own port simultaneously

## ⚙️ Configuration

### Project Configuration

Configuration is stored in `.opencode-tele/` within each project:

```
project/
├── .opencode-tele/
│   ├── config.json    # Bot token, user ID, settings
│   ├── state.json    # Session, model, mode state
│   └── bot.log       # Log file
```

### Environment Variables

You can also use environment variables instead of config files:

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export AUTHORIZED_USER_ID="your-user-id"
export OPENCODE_SERVER_URL="http://127.0.0.1:4097"
export LOG_LEVEL="debug"
```

### State Persistence

The bot persists:
- Current session ID per chat
- Selected model and mode
- Queued messages
- Cost tracking per session
- Prompt counters

## 🐛 Troubleshooting

### "Port already in use"

The bot will automatically try the next available port. Or use:
```bash
opencode-tele -p 5000  # Use a specific port
```

### "OpenCode is not installed"

```bash
npm install -g opencode-ai
opencode-tele --check
```

### Bot not responding

1. Check your user ID is correct
2. Verify bot token with [@BotFather](https://t.me/botfather)
3. Check logs in `.opencode-tele/bot.log`

### Session stuck

```bash
/opencode-tele abort  # Stop current task
/opencode-tele clear  # Clear session
/opencode-tele session  # Create new session
```

## 🧹 Uninstallation

```bash
# Remove global command
sudo npm uninstall -g opencode-tele

# Clean up project-specific configs
opencode-tele --uninstall
```

## 📝 Logging

Logs are written to `.opencode-tele/bot.log` with configurable levels:
- `debug`: All messages (default for development)
- `info`: General operations
- `warn`: Warnings only
- `error`: Errors only

Set via `LOG_LEVEL` environment variable or in config.

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a PR.

## 📜 License

MIT License