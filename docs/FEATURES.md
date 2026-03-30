# OpenCode Telegram Bot - Features Guide

## Session Management

### Create New Session
```
/session
```
Creates a new OpenCode session in the current project directory.

### Select Existing Session
```
/session <session_id>
```
Switch to an existing session by ID.

### Continue Old Session (Interactive)
```
/continue
```
Shows a list of recent sessions with inline buttons. Tap one to continue it.

### List Recent Sessions
```
/sessions
```
Shows the 10 most recent sessions with their IDs and titles.

### Show Current Status
```
/status
```
Displays current session, model, and mode settings.

### Clear Current Settings
```
/clear
```
Resets session, model, and mode to defaults.

---

## Model Selection

### List Available Models
```
/models
```
Shows all available providers and their models.

Example output:
```
*Available Models:*

*Anthropic*
  • claude-3-opus - Claude 3 Opus
  • claude-3-sonnet - Claude 3 Sonnet
  • claude-3-haiku - Claude 3 Haiku

*OpenAI*
  • gpt-4 - GPT-4
  • gpt-4-turbo - GPT-4 Turbo
  • gpt-3.5-turbo - GPT-3.5 Turbo

*Google*
  • gemini-pro - Gemini Pro
  • gemini-ultra - Gemini Ultra

Use `/model provider_id model_id` to select a model.
```

### Select a Model
```
/model anthropic claude-3-opus
/model openai gpt-4
/model google gemini-pro
```

### Show Current Model
```
/model
```
Shows the currently selected model or indicates default is being used.

---

## Mode Selection

### List Available Modes
```
/modes
```
Shows available modes/agents.

Example output:
```
*Available Modes:*

• build - Code implementation mode
• plan - Planning and design mode

Use `/mode <name>` to select a mode.
```

### Select a Mode
```
/mode build
/mode plan
/mode code
/mode review
/mode debug
```

### Show Current Mode
```
/mode
```
Shows the currently selected mode.

---

## Common Workflows

### 1. Starting Fresh
```
/session          # Create new session
/model anthropic claude-3-opus   # Select powerful model
/mode build       # Set to build mode
Hello, create a REST API for user management
```

### 2. Planning Phase
```
/mode plan        # Switch to planning mode
/model anthropic claude-3-sonnet  # Use faster model for planning
Plan a microservices architecture for an e-commerce app
```

### 3. Continuing Previous Work
```
/continue         # Interactive session picker
                  # (tap on the session you want to continue)
/status           # Check what session/model/mode is active
Continue implementing the authentication module
```

### 4. Switching Models Mid-Task
```
/model openai gpt-4      # Switch to GPT-4
Explain this code: ...
/model anthropic claude-3-opus  # Switch to Claude
Now refactor it to use TypeScript
```

### 5. Quick Status Check
```
/status
```

Output:
```
*Current Status*

*Session:*
ID: sess_abc123
Title: User Authentication API
Directory: /Users/you/project

*Model:*
Provider: anthropic
Model: claude-3-opus

*Mode:* build
```

---

## Keyboard Shortcuts

When you see inline buttons:

- **Tap a session** to select it
- **Tap a model** to select it
- **Tap a permission button** to approve/deny

---

## Tips

1. **Use `/continue`** - Don't memorize session IDs, just pick from the list
2. **Switch models** - Use faster models for planning, powerful ones for coding
3. **Check `/status`** - Always know what session/model/mode you're in
4. **Use modes** - Different modes can change how OpenCode responds
5. **Clear with `/clear`** - Start fresh without creating a new session

---

## Examples

### Full Development Session
```
# Start
/session
/model anthropic claude-3-opus
/mode build

# First task
Create a React component for user login with email and password validation

# Switch to planning
/mode plan
What's the best way to handle authentication tokens?

# Back to building
/mode build
Implement JWT token refresh mechanism

# Check status
/status
```

### Multi-Project Workflow
```
# Work on project A
/session
Create a database migration for users table

# Switch to project B
/session sess_xyz789
Fix the CSS layout issue in the dashboard

# Back to project A
/continue
# (select the first session)
Add email verification endpoint
```

---

## Environment Variables

Make sure your `.env` file has:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
AUTHORIZED_USER_ID=your_user_id
```

Optional:
```env
OPENCODE_SERVER_URL=http://localhost:4097
OPENCODE_SERVER_USERNAME=username
OPENCODE_SERVER_PASSWORD=password
```

---

## Troubleshooting

### "No providers found"
- Make sure OpenCode server is running
- Check that providers are configured in OpenCode settings

### "Session not found"
- Use `/sessions` to see available sessions
- The session might have been deleted

### "Model not working"
- Use `/models` to see valid model IDs
- Check that the provider is configured correctly

### Bot not responding
- Check bot token in `.env`
- Check your user ID in `.env`
- Look at logs: `tail -f bot.log`
