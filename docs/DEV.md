# Development Documentation

## Architecture Overview

This project bridges Telegram with OpenCode's HTTP server, providing a real-time, event-driven interface for AI coding assistance.

### System Architecture

```mermaid
graph TB
    subgraph "External"
        TG["Telegram API"]
        OC["OpenCode CLI"]
    end

    subgraph "Opencode-Telegram"
        subgraph "Entry Point"
            CLI["index.ts (CLI)"]
        end

        subgraph "Bot Layer"
            Bot["TelegramBot (orchestrator)"]
            Cmds["Commands (23)"]
            Hdlrs["Handlers"]
            Queue["MessageQueue"]
        end

        subgraph "OpenCode Layer"
            Client["OpenCodeClient"]
            Server["OpenCodeServer"]
            Events["EventProcessor"]
            Perms["PermissionHandler"]
        end

        subgraph "Support Layer"
            State["StateManager"]
            Config["Config Loader"]
            Logger["Logger"]
            Formatter["Formatter"]
        end
    end

    CLI --> Bot
    CLI --> Server
    Bot --> Cmds
    Bot --> Hdlrs
    Bot --> Queue
    Bot --> Events
    Bot --> Perms
    Hdlrs --> Client
    Perms --> Client
    Events --> Client
    Client --> State
    Cmds --> State
    Hdlrs --> State
    Config --> Bot
    Config --> Server
    Logger -.-> Bot
    Logger -.-> Client
    Logger -.-> Events
    Formatter -.-> Events

    TG <-->|"Long Polling"| Bot
    Server -->|"spawn"| OC
    Client <-->|"HTTP API"| OC
    Client <-->|"SSE Stream"| OC
```

### Event Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Telegram)
    participant B as TelegramBot
    participant Q as MessageQueue
    participant C as OpenCodeClient
    participant S as OpenCode Server
    participant E as EventProcessor

    Note over U,E: Startup
    B->>S: Start OpenCode server
    B->>C: Connect to OpenCode API
    C->>S: Subscribe to SSE /event
    B->>TG: Send "Online" notification

    Note over U,E: Message Flow
    U->>B: Send text message
    B->>Q: tryEnqueueAndSetBusy()
    alt Session busy
        Q-->>B: Already busy
        B-->>U: "Queued (position N)"
    else Session idle
        B->>B: Send "Working..." message
        B->>C: sendAsyncMessage(prompt)
        C->>S: POST /session/{id}/prompt_async
        S-->>E: SSE: message.started
        E-->>U: Update working message
        S-->>E: SSE: tool.* events
        E-->>U: Tool notifications
        S-->>E: SSE: question.asked
        E-->>U: Question with inline keyboard
        U->>B: Select option (callback)
        B->>C: replyQuestion(questionId, answer)
        C->>S: POST /question/{id}/reply
        S-->>E: SSE: message.completed
        E-->>U: "✅ Done!"
        Q->>B: Process next queued message
    end

    Note over U,E: Permission Flow
    S-->>E: SSE: permission.requested
    E->>B: Show permission keyboard
    B-->>U: "Once/Always/Reject"
    U->>B: Select option (callback)
    B->>C: replyPermission(requestId, response)
    C->>S: POST /session/{id}/permissions/{id}
    S-->>E: SSE: permission.granted
```

### State Management Flow

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Working: User sends message
    Working --> ToolUse: LLM calls tool
    ToolUse --> Working: Tool completes
    Working --> QuestionAsked: LLM asks question
    QuestionAsked --> Working: User answers
    QuestionAsked --> Working: User skips
    Working --> PermissionRequested: Tool needs permission
    PermissionRequested --> Working: User grants
    PermissionRequested --> Working: User rejects
    Working --> Completed: Task done
    Completed --> Idle: Ready for next
    Working --> Error: Error occurred
    Error --> Idle: Error handled
```

## Project Structure

```
src/
├── index.ts                   # CLI entry point
│                               - Parses CLI args
│                               - Runs interactive setup if needed
│                               - Starts OpenCode server (optional)
│                               - Creates and starts TelegramBot
│                               - Handles graceful shutdown
│
├── bot/
│   ├── index.ts               # TelegramBot class (orchestrator)
│   │                           - Composes all subsystems
│   │                           - Registers commands and handlers
│   │                           - Manages lifecycle (start/stop)
│   │
│   ├── commands.ts            # All /commands (23 commands)
│   │                           - Session management
│   │                           - Model/provider selection
│   │                           - Mode selection
│   │                           - File operations
│   │                           - Info/cost tracking
│   │
│   ├── handlers.ts            # Message + callback handlers
│   │                           - Text message relay to OpenCode
│   │                           - Callback query handling (permissions, questions, sessions)
│   │                           - Authorization checks
│   │
│   └── queue.ts               # Atomic message queue
│                               - Per-chat queue with atomic operations
│                               - Prevents race conditions
│                               - Persists to state file
│
├── opencode/
│   ├── client.ts              # HTTP client (native http/https, SSE)
│   │                           - Sessions CRUD
│   │                           - Message sending (sync/async)
│   │                           - Model/provider listing
│   │                           - Permission replies
│   │                           - Question replies
│   │                           - File operations
│   │                           - SSE subscription
│   │
│   ├── events.ts              # SSE event processor
│   │                           - Real-time event handling
│   │                           - Session state tracking
│   │                           - Outgoing message queue with rate limiting
│   │                           - Event type handlers:
│   │                             • session.created/started
│   │                             • message.created/started/completed
│   │                             • message.part.created/updated
│   │                             • permission.requested
│   │                             • question.asked
│   │                             • tool.started/completed
│   │                             • step.started
│   │                             • error
│   │
│   ├── permission.ts          # Permission request handler
│   │                           - Sends inline keyboard (Once/Always/Reject)
│   │                           - Handles permission replies
│   │
│   └── server.ts              # Spawns/manages `opencode serve`
│                               - 60-second startup timeout
│                               - Graceful shutdown (SIGTERM -> SIGKILL)
│                               - Pure mode (--pure flag)
│                               - Tunnel mode (--tunnel flag)
│
├── state/
│   └── manager.ts             # Persistent state (JSON file)
│                               - Current session per chat
│                               - Selected model/provider
│                               - Selected mode
│                               - Prompt counts
│                               - Atomic writes (tmp + rename)
│
├── types/
│   └── index.ts               # Zod schemas + TypeScript interfaces
│                               - OpenCode API types
│                               - Event types
│                               - Bot state types
│                               - Config types
│
└── utils/
    ├── config.ts              # Config loading/validation
    │                           - Env vars or project config files
    │                           - Zod validation
    │
    ├── formatter.ts           # Markdown escaping, message splitting
    │                           - Telegram Markdown compliance
    │                           - Message chunking for length limits
    │                           - File icon mapping
    │
    └── logger.ts              # File + console logger
                                - Multiple log levels
                                - File output to .opencode-tele/bot.log
```

## Development Workflow

### Setup
```bash
npm install
```

### Running in Development
```bash
# Uses tsx to run source directly
npm run dev
```

### Building
```bash
# Compiles TypeScript to JavaScript in dist/
npm run build
```

### Testing
```bash
# Run unit tests
npm test
```

### Local Global Test
```bash
npm run build
sudo npm install -g .
```

## Implementation Notes

### Networking
- Uses Node.js's native `http` module instead of `fetch` or `undici` for maximum compatibility
- 30-second request timeout
- Basic Auth support for protected OpenCode servers

### Event Handling
- SSE (Server-Sent Events) for real-time updates
- No polling - events are pushed from OpenCode
- Per-session state tracking
- Rate-limited outgoing messages (500ms delay)
- Telegram 429 rate limit handling with exponential backoff

### Message Queue
- Atomic `tryEnqueueAndSetBusy()` prevents race conditions
- Per-chat queue with position tracking
- Persisted to state file for recovery
- Processes next message automatically on completion

### Security
- Single authorized user only
- Authorization checked on every message and callback
- Localhost-only by default (--pure mode)
- Optional Cloudflare tunnel (--tunnel flag)

### State Persistence
- JSON file at `.opencode-tele/state.json`
- Atomic writes (write to .tmp then rename)
- Tracks sessions, models, modes, prompt counts
- Queue state recovery on startup

## Key Patterns

### Event Processing
```
SSE Event → handleEvent() → switch(type) → specific handler → queueMessage() → processOutgoingQueue()
```

### Message Flow
```
User Message → Authorization Check → Session Check → Queue Check → Send to OpenCode → Track State
```

### Permission Flow
```
permission.requested Event → PermissionHandler → Inline Keyboard → User Selection → replyPermission() → Continue
```

### Question Flow
```
question.asked Event → handleQuestionAsked() → Inline Keyboard with Options → User Selection → replyQuestion() → Continue
```

## Event Types Handled

| Event Type | Handler | Description |
|------------|---------|-------------|
| `session.created` | `handleSessionStarted` | Session ready for messages |
| `session.started` | `handleSessionStarted` | Session ready for messages |
| `message.created` | `handleMessageStarted` | Mark session as working |
| `message.started` | `handleMessageStarted` | Mark session as working |
| `message.part.created` | `handleMessagePartCreated` | Text/reasoning/file parts |
| `message.part.updated` | `handleMessagePartUpdated` | Text updates |
| `message.completed` | `handleMessageCompleted` | Task done, process queue |
| `session.completed` | `handleSessionIdle` | Session idle, process queue |
| `session.idle` | `handleSessionIdle` | Session idle, process queue |
| `permission.requested` | `handlePermissionRequested` | Show permission keyboard |
| `question.asked` | `handleQuestionAsked` | Show question with options |
| `tool.started` | `handleToolEvent` | Tool execution started |
| `tool.completed` | `handleToolEvent` | Tool execution completed |
| `step.started` | `handleStepStarted` | New step started |
| `error` | `handleError` | Error notification |

## Configuration

### Environment Variables
```bash
TELEGRAM_BOT_TOKEN=your-bot-token
AUTHORIZED_USER_ID=your-user-id
OPENCODE_SERVER_URL=http://127.0.0.1:4097
OPENCODE_ENABLE_EXA=1  # Enable web search
LOG_LEVEL=info
```

### Project Config
```json
{
  "telegramToken": "your-bot-token",
  "authorizedUserId": "your-user-id"
}
```

### State File
```json
{
  "sessions": { "123456789": "session-id" },
  "models": { "123456789": { "providerId": "openai", "modelId": "gpt-4" } },
  "modes": { "123456789": "build" },
  "promptCounts": { "123456789": 5 }
}
```
