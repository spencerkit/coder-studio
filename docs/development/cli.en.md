# CLI Manual

[中文](cli.md)

This document describes the CLI behavior currently implemented in `@spencer-kit/coder-studio`. It only covers commands and behavior that exist in the code today.

## Install

```bash
npm install -g @spencer-kit/coder-studio
```

After installation, the main entry command is:

```bash
coder-studio
```

## Directories and Files

The CLI maintains two local directory layers:

- `stateDir`: CLI state directory for `runtime.json`, `coder-studio.pid`, `coder-studio.log`, and `config.json`
- `dataDir`: runtime data directory, defaulting to `stateDir/data`, for `auth.json`, the database, and other runtime data

Default locations:

- Linux: `~/.local/state/coder-studio`
- macOS: `~/Library/Application Support/coder-studio`
- Windows: `%LOCALAPPDATA%\coder-studio`

Environment overrides:

- `CODER_STUDIO_HOME`: overrides `stateDir`
- `CODER_STUDIO_DATA_DIR`: overrides `dataDir`

Show the active paths with:

```bash
coder-studio config path
```

## Command Overview

Runtime control:

```bash
coder-studio start
coder-studio stop
coder-studio restart
coder-studio status
coder-studio logs -f
coder-studio open
coder-studio doctor
```

Configuration management:

```bash
coder-studio config show
coder-studio config get server.port
coder-studio config set server.port 41033
coder-studio config root set /srv/coder-studio/workspaces
coder-studio config password set --stdin
coder-studio config validate
```

Auth operations:

```bash
coder-studio auth status
coder-studio auth ip list
coder-studio auth ip unblock 203.0.113.12
coder-studio auth ip unblock --all
```

Shell completion:

```bash
coder-studio completion bash
coder-studio completion zsh
coder-studio completion fish
coder-studio completion install bash
coder-studio completion uninstall bash
```

Version:

```bash
coder-studio --version
```

Help:

```bash
coder-studio help
coder-studio help start
coder-studio help config
coder-studio help auth
coder-studio help completion
```

## Global Flags

Most runtime commands support:

- `--json`: structured output for scripts and CI
- `--host`: overrides the host used for this invocation
- `--port`: overrides the port used for this invocation

Additional flags on specific commands:

- `start --foreground`: keeps the runtime in the foreground for debugging
- `logs -f`: follows the runtime log
- `logs -n <lines>`: reads a specific number of tail lines
- `config password set --stdin`: reads the passphrase from stdin
- `auth ip unblock --all`: removes all currently blocked IPs at once

## Shell Completion

The CLI can print completion scripts for `bash`, `zsh`, and `fish`. The command only writes the script to stdout.

Print scripts directly:

```bash
coder-studio completion bash
coder-studio completion zsh
coder-studio completion fish
```

Load it for the current shell session:

```bash
eval "$(coder-studio completion bash)"
source <(coder-studio completion zsh)
coder-studio completion fish | source
```

Install into your local shell setup automatically:

```bash
coder-studio completion install bash
coder-studio completion install bash --force
coder-studio completion install zsh
coder-studio completion install fish
```

Install behavior:

- `bash`: writes `~/.coder-studio/completions/coder-studio.bash` and adds a managed `source` block to `~/.bashrc`
- `zsh`: writes `~/.coder-studio/completions/coder-studio.zsh` and adds a managed `source` block to `~/.zshrc`
- `fish`: writes `${XDG_CONFIG_HOME:-~/.config}/fish/completions/coder-studio.fish` without editing a profile

Uninstall:

```bash
coder-studio completion uninstall bash
coder-studio completion uninstall zsh
coder-studio completion uninstall fish
```

Notes:

- `install --force` rewrites the completion file and reapplies the managed profile block
- `uninstall` removes the completion script and strips the managed profile block added by the CLI

Manual persistent installation examples:

```bash
coder-studio completion bash >> ~/.bashrc
coder-studio completion zsh > ~/.zfunc/_coder-studio
coder-studio completion fish > ~/.config/fish/completions/coder-studio.fish
```

Notes:

- `coder-studio completion install <shell> --json` returns structured install output
- `coder-studio completion uninstall <shell> --json` returns structured uninstall output
- `coder-studio completion <shell>` does not support `--json`
- `coder-studio help completion` shows command usage

## Exit Codes

- `0`: success
- `1`: runtime or operation failure
- `2`: command usage, argument, or input validation failure

## Runtime Commands

### `start`

Starts the local runtime. If the runtime is already started under the current `stateDir`, the CLI returns the existing state.

```bash
coder-studio start
coder-studio start --foreground
coder-studio start --json
```

Notes:

- `server.host` and `server.port` are loaded from the current config by default
- `system.openCommand` does not affect `start`; it only affects `open`

### `stop`

Stops the runtime managed by the CLI.

```bash
coder-studio stop
coder-studio stop --json
```

### `restart`

Stops and starts the runtime again.

```bash
coder-studio restart
```

### `status`

Shows runtime status.

```bash
coder-studio status
coder-studio status --json
```

Output includes:

- current state: `running` / `degraded` / `stopped`
- whether the runtime is managed by the current CLI state
- endpoint
- PID
- `stateDir`
- log path

### `logs`

Reads or follows the runtime log.

```bash
coder-studio logs
coder-studio logs -n 200
coder-studio logs -f
```

Notes:

- when `-n` is omitted, the default comes from `logs.tailLines`
- `logs.tailLines` defaults to `80`

### `open`

Opens the running service endpoint in the default browser. If the runtime is not running yet, the CLI starts it first.

```bash
coder-studio open
```

Notes:

- the system default opener is used by default
- when `system.openCommand` is configured, that command is used to open the URL

### `doctor`

Prints diagnostic information about the runtime, bundle, state directory, and logs.

```bash
coder-studio doctor
coder-studio doctor --json
```

## `config` Command

### Subcommands

```bash
coder-studio config path
coder-studio config show
coder-studio config get <key>
coder-studio config set <key> <value>
coder-studio config unset <key>
coder-studio config validate
coder-studio config root show
coder-studio config root set <path>
coder-studio config root clear
coder-studio config password status
coder-studio config password set <value>
coder-studio config password set --stdin
coder-studio config password clear
coder-studio config auth public-mode <on|off>
coder-studio config auth session-idle <minutes>
coder-studio config auth session-max <hours>
```

### Supported Keys

- `server.host`
- `server.port`
- `root.path`
- `auth.publicMode`
- `auth.password`
- `auth.sessionIdleMinutes`
- `auth.sessionMaxHours`
- `system.openCommand`
- `logs.tailLines`

### Key Meanings

- `server.host`: runtime bind host
- `server.port`: runtime bind port
- `root.path`: the single root directory the frontend may access in public mode
- `auth.publicMode`: enables public-mode authentication
- `auth.password`: access passphrase; the CLI never prints it in clear text
- `auth.sessionIdleMinutes`: idle session timeout in minutes
- `auth.sessionMaxHours`: absolute session lifetime in hours
- `system.openCommand`: external open command used by `open`
- `logs.tailLines`: default tail size for `logs`

### Where Values Are Stored

The CLI exposes one config view, but it persists values into two files:

- `config.json`: CLI-only behavior
  - `system.openCommand`
  - `logs.tailLines`
- `auth.json`: runtime auth and server settings
  - `server.host`
  - `server.port`
  - `root.path`
  - `auth.publicMode`
  - `auth.password`
  - `auth.sessionIdleMinutes`
  - `auth.sessionMaxHours`

### Behavior Notes

- `root.path` is written into `auth.json` as the single-root `rootPath` field
- legacy `allowedRoots` values are still read for compatibility, but CLI writes back only `rootPath`
- `auth.password` is hidden in `show` and `get`
- while the runtime is already running:
  - `root.path`, `auth.publicMode`, `auth.password`, and session lifetime settings are applied immediately
  - `server.host` and `server.port` are persisted immediately, but require `restart` before the bind address changes
- changing `auth.password` or `auth.publicMode` clears current authenticated sessions

### Common Examples

Minimal public-mode setup:

```bash
coder-studio config root set /srv/coder-studio/workspaces
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio config auth public-mode on
```

Change the port and restart:

```bash
coder-studio config set server.port 42033
coder-studio restart
```

Inspect current configuration:

```bash
coder-studio config show
coder-studio config validate
```

## `auth` Command

### Subcommands

```bash
coder-studio auth status
coder-studio auth ip list
coder-studio auth ip unblock <ip>
coder-studio auth ip unblock --all
```

### `auth status`

Shows the current auth runtime state:

- whether the runtime is running
- current `server.host` / `server.port`
- current `root.path`
- `auth.publicMode`
- whether a passphrase is configured
- session lifetime settings
- current blocked IP count

### `auth ip list`

Lists IPs that are currently blocked.

Notes:

- only currently blocked IPs are shown
- blocked IP state is in-memory only and is not persisted to disk
- when the runtime stops, the blocked list naturally disappears

### `auth ip unblock`

Unblocks a single IP or all blocked IPs.

```bash
coder-studio auth ip unblock 203.0.113.12
coder-studio auth ip unblock --all
```

## Recommended Flows

Local development:

```bash
coder-studio start
coder-studio open
coder-studio status
```

Public deployment bootstrap:

```bash
coder-studio config root set /srv/coder-studio/workspaces
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio config auth public-mode on
coder-studio config set server.host 127.0.0.1
coder-studio config set server.port 41033
coder-studio restart
coder-studio auth status
```

Blocked-IP maintenance:

```bash
coder-studio auth ip list
coder-studio auth ip unblock --all
```
