# Mobile And Remote Access

Coder Studio runs on your machine and is accessed through a browser. Desktop, tablet, and phone use the same service URL, with layouts adapting to screen size.

## What Mobile Is Best For

Mobile is a continuation surface for work that usually starts on desktop:

- check whether an agent is still running
- read terminal output and status changes
- browse files and Git diffs
- inspect Supervisor progress
- decide whether you need to return to desktop and intervene

Mobile should not be positioned as a full replacement for desktop coding. Use desktop for first installation, Provider setup, large edits, and complex Git operations.

## Choose An Access Method

| Scenario | Recommended method |
|----------|--------------------|
| Phone and computer are on the same Wi-Fi | LAN IP access |
| Only your own devices need remote access | Tailscale |
| Temporary public URL for a demo or test | ngrok |
| Long-term public URL with your own domain | Cloudflare Tunnel |

Do not expose an unauthenticated Coder Studio service to the public internet.

## LAN Access

Set a password first:

```bash
coder-studio config --password <strong-password>
```

Make the service reachable from other devices on the network:

```bash
coder-studio config --host 0.0.0.0
coder-studio serve --restart
```

Check the port:

```bash
coder-studio status
```

Open this on your phone:

```text
http://<computer-lan-ip>:<port>
```

Example:

```text
http://192.168.1.23:4173
```

If it does not open, check that both devices are on the same network, guest isolation is disabled, the firewall allows the port, and the service is not listening only on `localhost`.

## Tailscale

Tailscale is the recommended option for personal remote access. It keeps access inside your private tailnet instead of exposing a public port.

Basic flow:

```bash
coder-studio config --password <strong-password>
coder-studio config --host 0.0.0.0
coder-studio serve --restart
tailscale status
```

Then open:

```text
http://<computer-tailscale-ip>:<port>
```

For HTTPS, Serve, or Funnel, follow Tailscale's official docs and review the access-control implications before making anything public.

## ngrok

ngrok is useful for temporary public access.

```bash
coder-studio status
ngrok http <port>
```

Open the generated HTTPS URL from your phone.

Use ngrok carefully:

- Set a Coder Studio password first
- Do not share the generated URL with untrusted people
- Stop ngrok after the demo or test

## Cloudflare Tunnel

Cloudflare Tunnel is useful when you want a longer-lived HTTPS URL, often with a domain you control.

Quick Tunnel example:

```bash
cloudflared tunnel --url http://localhost:<port>
```

For long-term use, create a managed tunnel in Cloudflare Zero Trust and map a hostname such as:

```text
https://coder.example.com -> http://localhost:<port>
```

For public exposure, pair this with Cloudflare Access or another identity layer.

## Security Checklist

- Set a strong Coder Studio password before LAN or remote access.
- Prefer Tailscale for personal cross-device access.
- Do not publish a raw unauthenticated port.
- Stop temporary tunnels when finished.
- Avoid opening sensitive projects through public links.

## Official References

- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
- [Tailscale Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)
- [ngrok HTTP Endpoints](https://ngrok.com/docs/http/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Cloudflare Quick Tunnels](https://try.cloudflare.com/)
