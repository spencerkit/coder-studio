# Runtime Directory Structure

Coder Studio uses a runtime directory for storing runtime configuration and local data.

## Default Location

- **Unix/macOS**: `~/.coder-studio/`
- **Windows**: `%USERPROFILE%\.coder-studio\`
- **Custom**: Set `CODER_STUDIO_RUNTIME_DIR` environment variable

## Directory Structure

```
~/.coder-studio/
├── runtime.json          # Runtime configuration (port, token)
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

## Security

- The runtime directory should be user-readable only (700 permissions)
- The `token` in `runtime.json` is used to authenticate internal endpoints

## Lifecycle

1. **Server Startup**: Write `runtime.json` with port/token
2. **Runtime**: Commands and clients read `runtime.json` to discover the active server
3. **Server Shutdown**: Remove `runtime.json`
