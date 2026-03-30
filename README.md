# OpenCode Telegram Bot

Control your [OpenCode](https://github.com/opencode-ai/opencode) server from anywhere using Telegram. This bot allows you to prompt OpenCode, manage sessions, browse files, and approve permissions directly from your phone or desktop.

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [OpenCode](https://github.com/opencode-ai/opencode) installed globally (`npm install -g opencode-ai`)

### 2. Installation
Clone this repository and install it globally on your system:

```bash
git clone https://github.com/vineetkishore01/Opencode-Telegram.git
cd Opencode-Telegram/opencode-telegram-bot
npm install
npm run build
sudo npm install -g .
```

### 3. Usage
Navigate to any project directory where you want to use OpenCode and run:

```bash
opencode-tele
```

**First Run Setup:**
The bot will guide you through setting up your Telegram Bot Token and Authorized User ID. 
- Get a token from [@BotFather](https://t.me/botfather)
- Get your User ID from [@userinfobot](https://t.me/userinfobot)

## 🛠 Commands

| Command | Description |
|---------|-------------|
| `/session` | Create a new OpenCode session |
| `/sessions` | List 10 most recent sessions |
| `/status` | Show current session, model, and mode |
| `/abort` | Stop the currently running task |
| `/files` | List files in the current project |
| `/cost` | Show token usage and cost for the session |
| `/help` | Show all available commands |

## 🧹 Uninstallation
To completely remove the bot and its configurations:

```bash
# Remove global command
sudo npm uninstall -g opencode-tele

# Clean up project-specific configs
opencode-tele --uninstall
```

## ⚙️ Configuration
The bot saves project-specific configurations in a `.opencode-tele/` directory within your project folder. This includes your bot token, authorized user ID, and session state.

---
MIT License
