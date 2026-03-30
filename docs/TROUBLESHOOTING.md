# Troubleshooting - OpenCode Telegram Bot

## Bot Issues

### Bot not responding
1. Check bot token is correct in `.env`
2. Verify your user ID matches `AUTHORIZED_USER_ID`
3. Check logs: `tail -f bot.log`
4. Restart the bot

### "Not authorized" error
- The bot only responds to the user ID configured in `AUTHORIZED_USER_ID`
- Get your ID from [@userinfobot](https://t.me/userinfobot)
- Update the `.env` file with the correct ID

### Messages not sending
- Check Telegram API rate limits
- Check bot.log for API errors
- Ensure the bot hasn't been blocked by the user

## OpenCode Server Issues

### "OpenCode is not installed"
```bash
npm install -g opencode-ai
```

### Cannot connect to OpenCode
1. Verify OpenCode server is running
2. Check `OPENCODE_SERVER_URL` in `.env`
3. Test connection: `curl http://localhost:4097/session`
4. Try a different port: `opencode-tele -p 5000`

### Port already in use
```bash
# Use a different port
opencode-tele -p 5000

# Or kill the process using the port
lsof -ti:4097 | xargs kill -9
```

### OpenCode server fails to start
1. Check if `opencode` is in PATH: `which opencode`
2. Check the project directory exists
3. Check server logs in bot.log

## Permission Issues

### Permission requests not appearing
1. Check event processor is running
2. Check bot logs for permission events
3. Verify OpenCode supports SSE events
4. Restart the bot

### Permission buttons not working
1. Check callback query handlers are registered
2. Verify the bot has permission to edit messages
3. Check bot.log for callback errors

## Session Issues

### "No session selected"
- Use `/session` to create a new session
- Or `/continue` to select an existing one

### Session not found
- The session may have been deleted on the server
- Use `/sessions` to list available sessions
- Create a new session with `/session`

### Session stuck (not responding)
- Use `/abort` to stop the current task
- If that doesn't work, restart the bot

## Model Issues

### No models found
1. Ensure OpenCode has providers configured
2. Check OpenCode config for API keys
3. Restart OpenCode server

### Model not working
1. Use `/providers` to see available providers
2. Use `/models <provider>` to see models
3. Select with `/model <provider> <model_id>`

## Cost Tracking

### Cost not showing
- Costs appear after each completed response (step-finish)
- Use `/cost` to see total session costs
- Cost tracking starts from when you begin using the feature

## File Operations

### Files command returns empty
1. Ensure you have an active session
2. The project directory must exist
3. Check OpenCode server logs

### File content not showing
1. Verify the file path is correct
2. Check file permissions
3. Ensure the file isn't too large (>100KB may be truncated)

## Queue System

### Messages not queuing
- The queue only works when a session is actively processing
- If the session is idle, messages are sent immediately
- Check if the session is actually busy

## Log Files

### Finding logs
```bash
# Bot logs (in project directory)
tail -f bot.log

# OpenCode server logs
# Check the terminal where opencode-tele was started
```

### Log levels
Set `LOG_LEVEL` in `.env`: `debug`, `info`, `warn`, `error`

## Building

### TypeScript compilation errors
```bash
npm run typecheck  # Check for type errors
npm run build      # Rebuild
```

### Module not found
```bash
rm -rf node_modules
npm install
npm run build
```

## Uninstalling

```bash
npm uninstall -g opencode-tele
```
