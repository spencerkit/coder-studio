# Troubleshooting

Use this page when Coder Studio does not start, cannot reach a provider, or cannot be opened from another device.

## First-Run Checklist

If the first trial does not work, check in this order:

1. `node --version` confirms Node.js >= 24.0.0.
2. `coder-studio version` confirms the CLI is installed.
3. `coder-studio status` confirms the service is running.
4. `coder-studio logs` shows recent errors.
5. `which <provider-command>` confirms the Provider CLI is in PATH.
6. `<provider-command> --version` confirms the Provider CLI can run.
7. If the browser does not open, manually visit the URL from `coder-studio status`.
8. If mobile cannot connect, confirm the service listens on `0.0.0.0` and your firewall allows the port.

Use desktop for the first full trial. Do not start by debugging public tunnels and phone access at the same time.

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

Coder Studio can open files and terminals without an AI CLI, but agent sessions require their matching provider CLIs.

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

## Update Recovery

Open **About & Updates → Update status**, then expand **Component diagnostics**. This shows which
authority owns the update, the active environment, component version transitions, the failed phase,
recovery guidance, and the exact log locations available for that installation.

If a global npm CLI update reports **Manual action required**, select and copy the complete command
shown under **Manual Command**, run it in a terminal with the permissions used for the global npm
installation, and then restart Coder Studio. Do not shorten the command or replace its exact target
version with a moving npm tag.

Choosing **Restart later** closes the confirmation without beginning the restart. A verified Desktop
download remains ready for a later restart; a CLI installation does not start until its confirmation
is accepted. Reopen **Update status** when it is safe to interrupt active terminals, sessions, and
Supervisor tasks.

A **pending** Product Runtime is verified and staged but has not completed activation and its health
check. A **quarantined** Runtime failed activation or health verification; Coder Studio retains the
previous healthy Runtime and will not automatically retry the quarantined candidate. Review the
reported failure, correct the underlying issue, and use the update screen's explicit retry action.

An external browser connected to a Desktop sidecar cannot take over Desktop update authority. Open
the installed Coder Studio Desktop application on the Windows host and continue from its **Update
status** page. For WSL, recovery is still initiated by that Windows Desktop application, not by npm
inside the distribution.

Desktop diagnostics report the Electron log (normally `main.log` under Electron's logs directory)
and the update journal is stored at `<userData>/desktop-update-plan.json`. CLI update worker failures
are recorded under the configured Coder Studio state directory in `logs/update-worker.log`. Use the
paths displayed by **Component diagnostics** when they differ from these names. Journals and Runtime
current, pending, or failed pointers are recovery state owned by Coder Studio; do not edit or delete
them manually.

## Still Stuck

Collect:

- `coder-studio status`
- Relevant `coder-studio logs`
- Browser URL used
- Operating system
- Node.js version
- Whether the issue happens locally, on LAN, or through a tunnel
