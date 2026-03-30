# Development Documentation

## Architecture

The project is structured as follows:

- `src/index.ts`: Entry point and CLI argument handling.
- `src/bot/`: Telegram bot logic using [grammY](https://grammy.dev/).
  - `commands.ts`: Command registrations.
  - `handlers.ts`: Message and callback handling.
  - `queue.ts`: Local message queue to prevent race conditions.
- `src/opencode/`: OpenCode API client and server management.
  - `client.ts`: Robust HTTP client using native `http` module.
  - `server.ts`: Spawns and manages the `opencode serve` process.
  - `events.ts`: Polling mechanism for status and permissions.
- `src/state/`: Persistent state management for sessions and preferences.

## Development Workflow

### Setup
```bash
npm install
```

### Running in Development
```bash
# This uses tsx to run the source directly
npm run dev
```

### Building
```bash
# Compiles TypeScript to JavaScript in dist/
npm run build
```

### Local Global Test
If you want to test the global command without publishing to npm:
```bash
npm run build
sudo npm install -g .
```

## Implementation Notes

- **Networking**: We use Node.js's native `http` module instead of `fetch` or `undici` to ensure maximum compatibility across different environments and prevent "terminated" connection errors.
- **Event Handling**: Instead of SSE (Server-Sent Events) which can be unstable in some local setups, the bot uses a robust polling mechanism in `events.ts` to check for status updates every 1.5 seconds.
- **Security**: Authorization is strictly enforced. The bot will only respond to the `AUTHORIZED_USER_ID` defined during setup.
