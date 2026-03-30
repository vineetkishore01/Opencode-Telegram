# Architecture - OpenCode Telegram Bot

## Overview

A Telegram bot that enables remote development with OpenCode. The bot acts as a bridge between Telegram and the OpenCode server, forwarding prompts and streaming back AI responses, tool executions, permission requests, and file changes.

## System Flow

```
┌─────────────────────────────────────┐
│        Telegram User                │
│         (Mobile/Desktop)            │
└──────────────┬──────────────────────┘
               │ HTTP/WebSocket
               ▼
┌─────────────────────────────────────┐
│     Telegram API                    │
│   (Message Delivery)                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   OpenCode Telegram Bot            │
│   ┌─────────────────────────────┐  │
│   │  Telegram Bot (Grammy)      │  │
│   │  - Command handlers         │  │
│   │  - Message handlers         │  │
│   │  - Callback handlers        │  │
│   └──────────────┬──────────────┘  │
│                  │                  │
│   ┌──────────────▼──────────────┐  │
│   │  OpenCode Client            │  │
│   │  - REST API calls           │  │
│   │  - SSE event subscription   │  │
│   └──────────────┬──────────────┘  │
│                  │                  │
│   ┌──────────────▼──────────────┐  │
│   │  Event Processor            │  │
│   │  - Permission handling      │  │
│   │  - Message formatting       │  │
│   │  - State management         │  │
│   └─────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│        OpenCode Server             │
│   ┌─────────────────────────────┐  │
│   │  REST API                   │  │
│   │  - Sessions                 │  │
│   │  - Messages                 │  │
│   │  - Permissions              │  │
│   └──────────────┬──────────────┘  │
│                  │                  │
│   ┌──────────────▼──────────────┐  │
│   │  Event Bus                  │  │
│   │  - SSE streaming            │  │
│   └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Components

### 1. CLI Entry Point (`src/index.ts`)
- Parses command line arguments
- Loads configuration from env vars and global config
- Starts OpenCode server if needed
- Creates and starts the Telegram bot
- Handles graceful shutdown

### 2. Telegram Bot (`src/bot/`)
- **index.ts** - Main orchestrator class
- **commands.ts** - Telegram command handlers (/start, /session, /models, etc.)
- **handlers.ts** - Text message and callback query handlers
- **queue.ts** - Message queue for sequential processing

### 3. OpenCode Integration (`src/opencode/`)
- **client.ts** - REST API client with timeout and retry
- **server.ts** - OpenCode server process manager
- **events.ts** - SSE event stream processor
- **permission.ts** - Permission request handler with inline buttons

### 4. State Management (`src/state/`)
- **manager.ts** - Persistent state storage (sessions, models, modes, costs)

### 5. Utilities (`src/utils/`)
- **config.ts** - Configuration loading (env vars, global config)
- **formatter.ts** - Telegram Markdown formatting, ANSI stripping, file icons
- **logger.ts** - File-based logger with levels

### 6. Types (`src/types/`)
- **index.ts** - Zod schemas and TypeScript type definitions

## Data Flow

1. User sends message via Telegram
2. Grammy bot receives the message
3. Handler checks authorization and session
4. Message is sent to OpenCode via REST API
5. OpenCode processes and emits SSE events
6. Event processor handles each event type
7. Formatted messages are sent back to Telegram

## Event Types Handled

| Event | Handler | Description |
|-------|---------|-------------|
| `permission.asked` | PermissionHandler | Shows inline buttons |
| `message.part.updated` | EventProcessor | Reasoning, tool, text updates |
| `file.edited` | EventProcessor | File change notifications |
| `session.idle` | EventProcessor | Task completion |
| `session.error` | EventProcessor | Error notifications |
| `session.status` | EventProcessor | Busy/idle/retry status |
| `question.asked` | EventProcessor | AI multi-choice questions |
| `todo.updated` | EventProcessor | Task list updates |
| `installation.update-available` | EventProcessor | Update notifications |
| `server.connected` | EventProcessor | Connection status |

## State Persistence

State is saved to `bot-state.json` containing:
- Session mappings (chatId → sessionId)
- Model selections (chatId → {providerId, modelId})
- Mode selections (chatId → mode)
- Cost tracking (sessionId → {cost, tokens})
- Prompt counters (chatId → count)
