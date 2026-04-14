# Runtime Directory Structure

Coder Studio uses a runtime directory for storing configuration and hook scripts.

## Default Location

- **Unix/macOS**: `~/.coder-studio/`
- **Windows**: `%USERPROFILE%\.coder-studio\`
- **Custom**: Set `CODER_STUDIO_RUNTIME_DIR` environment variable

## Directory Structure

```
~/.coder-studio/
├── runtime.json          # Runtime configuration (port, token)
├── hooks/                # Hook bridge scripts
│   ├── claude-bridge.js  # Claude provider hook bridge
│   └── codex-bridge.js   # Codex provider hook bridge
├── data/                 # SQLite database and user data
│   └── coder-studio.db   # Main database
└── logs/                 # Server logs (Phase 2+)
```

## runtime.json

The `runtime.json` file contains runtime configuration written by the server on startup:

```json
{
  "version": "1.0",
  "port": 4173,
  "token": "random-secure-token",
  "pid": 12345,
  "startedAt": "2026-04-14T12:00:00Z"
}
```

### Fields

- `version`: Configuration schema version
- `port`: Server port number
- `token`: Authentication token for internal endpoints
- `pid`: Server process ID
- `startedAt`: Server start timestamp

## Hook Bridge Scripts

Hook bridge scripts are deployed to `~/.coder-studio/hooks/` during the build process.

### Purpose

Hook bridge scripts receive hook events from providers (Claude, Codex) and forward them to the Coder Studio server via HTTP.

### Implementation

- **Zero external dependencies**: Pure Node.js
- **Silent failure**: If server is not running, scripts exit gracefully
- **Fire-and-forget**: POST events without waiting for response

### Example Usage

```bash
# Claude hook configuration in ~/.claude/settings.json
{
  "hooks": {
    "SessionStart": "node ~/.coder-studio/hooks/claude-bridge.js SessionStart"
  }
}
```

## Security

- The runtime directory should be user-readable only (700 permissions)
- The `token` in `runtime.json` is used to authenticate internal endpoints
- Hook scripts validate the token before sending events

## Lifecycle

1. **Server Startup**: Write `runtime.json` with port/token
2. **Build/Assemble**: Deploy hook scripts to `hooks/`
3. **Provider Config**: Update provider settings to use hook scripts
4. **Runtime**: Hook scripts forward events to server
5. **Server Shutdown**: Remove `runtime.json`
