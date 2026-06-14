# Security And Privacy

Coder Studio is local-first: the server runs on your machine and opens your local project directories. That makes the security model different from a hosted cloud IDE.

## What Runs Where

- Coder Studio server runs on your machine.
- The web UI is served from that local server.
- Project files are read from local directories that you open as workspaces.
- Agent sessions run through the matching local Provider CLI when you start them.
- SQLite stores Coder Studio local state.

## What Leaves Your Machine

Coder Studio does not operate a hosted code service for your workspace, but any Provider CLI you run may send prompts, code context, terminal output, file snippets, or other task data according to that provider's own behavior and configuration.

Review the provider CLI's documentation and account settings if you need strict data-handling guarantees.

## Authentication

Before allowing access from another device, set a password:

```bash
coder-studio config --password <strong-password>
coder-studio serve --restart
```

Authentication is especially important when using:

- LAN access from other devices
- Tailscale Funnel
- ngrok
- Cloudflare Tunnel
- Any public or semi-public network

## Network Exposure

By default, local access is the safest mode. Remote access increases risk because anyone who reaches the service may be able to interact with files, terminals, sessions, and AI tools.

Treat remote Coder Studio access like remote shell access: anyone who can authenticate may be able to read files, run terminal commands, and trigger provider tools with the permissions of your local user.

Recommended order:

1. Local browser access on the same machine
2. Tailscale for your own devices
3. Cloudflare Tunnel with an identity layer
4. ngrok for temporary demos
5. Direct public port exposure only if you fully understand the risk

Do not expose Coder Studio without authentication.

## Project Safety

Be cautious when opening:

- Private company repositories
- Repositories with secrets in files or environment variables
- Production infrastructure scripts
- Projects with destructive commands in common workflows

Coder Studio provides a workspace. The AI provider and shell commands can still make changes according to the permissions available on your machine.

## Practical Checklist

- Set a password before cross-device use.
- Prefer Tailscale for personal remote access.
- Keep provider CLIs updated.
- Review Git diffs before committing AI-generated changes.
- Stop tunnels when you no longer need them.
- Avoid using public links for sensitive repositories.
