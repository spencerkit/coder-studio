# Deployment Guide

[中文](README.md)

This directory explains how to deploy the current build to a publicly reachable environment with the implemented single-passphrase authentication.

## Current Deployment Capabilities

The current code supports:

- single-user, single-passphrase login
- `HttpOnly` session cookie
- a `24` hour IP ban after `3` failed passphrase attempts within `10` minutes
- server-side single-root restrictions through `rootPath`
- authentication on both `HTTP RPC` and `WebSocket`
- passphrase submission over either HTTP or HTTPS for non-local hosts
- local access on `localhost`, `127.0.0.1`, and `::1` defaults to non-public mode
- local access with `?auth=force` explicitly forces public mode

## Recommended Topology

Recommended structure:

1. run the Coder Studio process on a loopback address
2. terminate HTTPS with `Caddy` or `Nginx`
3. reverse proxy `/`, `/api`, `/ws`, and `/health` to the local Coder Studio process

Why this is recommended:

- the application process does not terminate TLS itself
- HTTPS avoids sending the passphrase and session cookie over a clear-text network path
- a reverse proxy is the right place for certificates, domains, and public ingress

## Configuration File

After the first launch, the app creates `auth.json` inside the app data directory.

If you use the CLI defaults, the first launch starts with these values automatically:

- `publicMode`: `true`
- `rootPath`: `~/coder-studio-workspaces`
- `bindHost`: `127.0.0.1`
- `bindPort`: `41033`
- `sessionIdleMinutes`: `15`
- `sessionMaxHours`: `12`

That means you do not need to preconfigure `rootPath`, `bindHost`, or `bindPort` just to get started. In the default case, setting the password is enough.

Typical locations:

- Linux: `~/.local/share/com.spencerkit.coderstudio/auth.json`
- macOS: `~/Library/Application Support/com.spencerkit.coderstudio/auth.json`
- Windows: `%AppData%\\com.spencerkit.coderstudio\\auth.json`

Key fields:

```json
{
  "version": 1,
  "publicMode": true,
  "password": "replace-this-passphrase",
  "rootPath": "/srv/coder-studio/workspaces",
  "bindHost": "127.0.0.1",
  "bindPort": 41033,
  "sessionIdleMinutes": 15,
  "sessionMaxHours": 12,
  "sessions": []
}
```

Field meanings:

- `publicMode`: enables public access mode
- `password`: the access passphrase, currently stored in plain text by request
- `rootPath`: the single root directory that can be browsed or used for workspaces
- `bindHost`: transport service bind address
- `bindPort`: transport service bind port

Notes:

- legacy `allowedRoots` values are still read for compatibility
- the current CLI and runtime write back only `rootPath`

## Recommended `bindHost` / `bindPort`

Recommended production values:

- `bindHost`: `127.0.0.1`
- `bindPort`: `41033`

That means:

- the app only listens locally
- public traffic is easier to control through a reverse proxy

If you explicitly want the process to listen beyond loopback, you can set:

- `bindHost`: `0.0.0.0`

But even then, public access should still sit behind an HTTPS reverse proxy because the app does not provide TLS directly, and plain HTTP would expose the passphrase plus a non-`Secure` session cookie on the wire.

## Reverse Proxy Requirements

Your proxy should forward:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

If the proxy terminates HTTPS, keep forwarding `X-Forwarded-Proto=https` so the runtime can mark the returned session cookie as `Secure`.

## Caddy Example

```caddyfile
coder.example.com {
  reverse_proxy 127.0.0.1:41033
}
```

`Caddy` handles HTTPS and WebSocket proxying out of the box, so this is the simplest public setup.

## Nginx Example

```nginx
server {
  listen 443 ssl http2;
  server_name coder.example.com;

  ssl_certificate /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:41033;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Deployment Steps

1. Build the app: `pnpm build:web && pnpm build:server && pnpm build:cli`
2. Install the CLI on the target machine: `npm install -g @spencer-kit/coder-studio`
3. Set the access passphrase
4. Override `rootPath`, `bindHost`, or `bindPort` only if you need non-default values
5. Start or restart the app
6. Configure a reverse proxy to `bindHost:bindPort` as needed, with HTTPS still recommended for public ingress
7. Open your domain and verify the login screen appears first

Minimal setup:

```bash
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio start
```

Notes:

- if you accept the default workspace directory and bind address, the two commands above are enough
- on an interactive terminal, the first `coder-studio start`, `coder-studio restart`, or `coder-studio open` also prompts for a passphrase if none is configured yet, then continues startup
- non-interactive environments do not enter the prompt flow, so configure the passphrase first with `coder-studio config password set --stdin`

Use this flow only when you want custom paths or bind settings:

```bash
coder-studio config root set /srv/coder-studio/workspaces
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio config auth public-mode on
coder-studio config set server.host 127.0.0.1
coder-studio config set server.port 41033
coder-studio start
```

## Verification Checklist

- opening the public domain shows the passphrase login screen first
- 3 wrong passphrase attempts trigger the IP block response
- after login, WebSocket connections establish normally
- only directories inside `rootPath` are accessible
- direct local access via `http://localhost:41033` defaults to non-public mode
- direct local access via `http://localhost:41033/?auth=force` forces the login screen

## Current Boundaries

The current version does not include:

- multi-user auth
- a password change UI
- second-factor auth
- audit logs
- persisted failed-login records

If those are needed later, they should be handled as a separate second-phase design.
