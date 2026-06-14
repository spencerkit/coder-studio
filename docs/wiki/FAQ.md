# FAQ

## Is Coder Studio A Cloud IDE?

No. Coder Studio runs on your own machine and serves a browser UI from that local runtime. You can expose it to other devices, but the development environment remains local.

## Does My Code Leave My Machine?

Coder Studio itself is local-first. However, provider CLIs may send task context according to their own behavior and settings. Review the provider's documentation if this matters for your project.

## Is Coder Studio A Replacement For VS Code Or Cursor?

Not directly. Coder Studio is strongest as a browser workspace around vibe coding sessions, terminals, files, Git, and cross-device visibility. Use a desktop editor when you need deep manual editing.

## Do I Need A Provider CLI Installed?

Only for AI sessions. You can still use Coder Studio for file browsing and terminals without provider CLIs installed. Install the CLI for each provider you want to run.

## Can I Use It From My Phone?

Yes. Use LAN access when your phone is on the same network, or use Tailscale/ngrok/Cloudflare Tunnel for remote access. Set a password before exposing the service to other devices.

## Can I Edit Code On Mobile?

Mobile is best for checking status, reading output, viewing files, and light operations. Desktop remains better for deep editing and complex terminal work.

## Can I Share A Workspace With Someone Else?

Technically yes if you expose the service URL, but be careful. A workspace can include file and terminal access. Use authentication, share only with trusted people, and stop temporary tunnels when finished.

## Where Is State Stored?

Coder Studio stores local app state in its local data directory, backed by SQLite. Project files remain in the workspace directories you open.

## What Happens If I Close The Browser?

The managed service can keep running in the background. Reopen Coder Studio with:

```bash
coder-studio open
```

or check it with:

```bash
coder-studio status
```

## How Do I Stop It?

```bash
coder-studio stop
```
