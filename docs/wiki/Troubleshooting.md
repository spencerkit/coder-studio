# Troubleshooting

Use this page when Coder Studio does not start, cannot reach a provider, or cannot be opened from another device.

## Coder Studio Does Not Start

Check status and logs:

```bash
coder-studio status
coder-studio logs
```

Try foreground mode for a direct error:

```bash
coder-studio serve --foreground
```

## Browser Did Not Open

Run:

```bash
coder-studio status
```

Open the displayed URL manually.

## Port Is Already In Use

Change the port and restart:

```bash
coder-studio config --port 8080
coder-studio serve --restart
```

## Provider Is Missing

Coder Studio can open files and terminals without an AI CLI, but Claude and Codex sessions require their matching provider CLIs.

Install the provider CLI, confirm it works in a normal terminal, then start a new session in Coder Studio.

## Phone Cannot Open The Workspace

Common causes:

- Phone and computer are not on the same network.
- Wi-Fi guest isolation blocks device-to-device access.
- The computer firewall blocks the port.
- Coder Studio is listening only on `localhost`.
- VPN, company network, or campus network blocks local device discovery.

For LAN access:

```bash
coder-studio config --host 0.0.0.0
coder-studio serve --restart
coder-studio status
```

Then open:

```text
http://<computer-lan-ip>:<port>
```

## Login Or Password Problems

Reset the password:

```bash
coder-studio config --password <new-strong-password>
coder-studio serve --restart
```

If an IP is blocked after repeated failed attempts:

```bash
coder-studio auth ban-list
coder-studio auth unblock --ip <ip-address>
```

## WebSocket Or Connection Issues

Try:

- Refreshing the browser.
- Checking `coder-studio status`.
- Checking `coder-studio logs`.
- Confirming the tunnel or network route is still active.
- Restarting the service with `coder-studio serve --restart`.

## Still Stuck

Collect:

- `coder-studio status`
- Relevant `coder-studio logs`
- Browser URL used
- Operating system
- Node.js version
- Whether the issue happens locally, on LAN, or through a tunnel
