# Why Coder Studio

Coder Studio is not trying to replace every editor or every terminal. It is built for developers who run vibe coding agents and want a persistent, inspectable workspace around those agents.

Another way to frame it: Coder Studio is an agentic coding harness. It does not just ask an AI to write code. It keeps the surrounding engineering loop visible: commands, terminal output, files, Git diffs, sessions, mobile access, and human review.

Vibe coding agents are powerful, but the raw workflow is still fragmented:

- the agent runs in one terminal
- files and diffs live in another editor
- verification happens in separate shell tabs
- long-running tasks are hard to monitor away from your desk
- mobile access usually means SSH or remote desktop

Coder Studio turns that scattered workflow into one local browser workspace.

| Pain | Without Coder Studio | With Coder Studio |
|------|----------------------|-------------------|
| Long agent tasks | Watch a terminal or come back later and reconstruct context | Keep sessions, terminal output, files, and Git changes visible in one workspace |
| Cross-device work | Use SSH, remote desktop, or rebuild context on another machine | Reopen the same local workspace from desktop, tablet, or phone |
| Reviewing AI changes | Jump between terminal, editor, and Git tools | Inspect files and diffs beside the agent session |
| Multiple agents | Manage separate terminal windows and histories | Run Claude and Codex sessions side by side in one workspace |
| Local-first control | Move work into a hosted IDE or cloud VM | Keep the runtime and project files on your own machine |

## Compared With Vibe Coding Tools

Vibe coding is useful for fast exploration: describe intent, let the AI produce code, then steer by feel. That speed is valuable, but real projects still need context, review, and verification.

Coder Studio adds a harness around that flow:

- Agent sessions stay attached to a real workspace.
- Terminal output and shell verification stay visible.
- Git changes can be inspected beside the session.
- Multiple agents can be compared in the same project.
- The same workspace can be reopened from another device.

Use vibe coding for momentum. Use Coder Studio when you want that momentum inside a visible local engineering loop.

## Compared With Claude Code Or Codex CLI

The CLIs are the agent runtime. Coder Studio wraps them in a browser workspace.

Coder Studio adds:

- Session list and active session switching
- Project file tree and editor
- Git status and diff views
- Shell terminals beside agent terminals
- Mobile and tablet layouts
- Workspace continuity across devices

Use the raw CLI when you want the smallest possible terminal workflow. Use Coder Studio when you want visibility around long-running or multi-session agent work.

## Compared With Cursor Or VS Code

Cursor and VS Code are strong interactive editors. Coder Studio is strongest when an agent is running and you want to observe, verify, or switch devices.

Coder Studio adds:

- Browser access to the same local workspace
- A mobile-friendly status and terminal view
- Multiple provider sessions in one workspace
- A local-first web runtime that can be opened from another device

It is not meant to replace a full desktop editor for deep manual editing.

## Compared With Cloud IDEs

Cloud IDEs host your environment in the cloud. Coder Studio runs on your own machine.

This matters when:

- You want project files to stay local
- You already have local toolchains configured
- You want to reuse Claude Code or Codex CLI directly
- You want remote access without moving the development environment to a hosted VM

## Compared With SSH Or Remote Desktop

SSH and remote desktop give access to a machine. Coder Studio gives a workspace designed for vibe coding.

On a phone or tablet, a responsive workspace is easier to inspect than a mirrored desktop. You can check session output, files, Git changes, and terminals without fighting a tiny desktop UI.

## Best Fit

Coder Studio is a good fit if you:

- Use Claude Code or Codex frequently
- Run long agent tasks
- Need to check progress away from the desk
- Want project files and terminals in one browser UI
- Prefer local-first tools over hosted cloud IDEs

It is less useful if you only want a normal editor, do not use vibe coding agents, or never need cross-device visibility.
