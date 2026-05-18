# Vibe Coding Terms

Vibe coding vocabulary changes quickly. This page defines the terms most relevant to Coder Studio's positioning.

## Vibe Coding

Vibe coding describes a natural-language-first style of software creation: the human describes intent, the AI produces code, and the human steers the result through conversation and quick feedback.

It is useful for:

- Prototyping ideas quickly
- Exploring unfamiliar code
- Generating first drafts
- Moving from product intent to running code faster

Its weakness is that speed can outrun verification. A generated change still needs tests, code review, security checks, and a clear understanding of what changed.

Coder Studio's angle is not "forget the code exists." It is "keep the generated code, terminal output, Git diff, and verification loop visible while using AI aggressively."

## Agentic Coding

Agentic coding means the AI does more than autocomplete. It can inspect files, run commands, modify code, react to failures, and continue through multiple steps.

Coder Studio is designed around this mode:

- Each agent session has visible output.
- Files and Git changes are available beside the session.
- Shell terminals can be used for independent verification.
- Sessions remain available across device switches.

## Agent Harness

An agent harness is the structure around an AI agent that makes its work observable and repeatable. For coding agents, that usually means:

- Workspace context
- Tool access
- Terminal output
- Command results
- File diffs
- Review checkpoints
- Recovery when something fails

Coder Studio acts as a local workspace harness for Claude Code and Codex. It does not replace those agents; it gives them a durable browser workspace.

## Eval Harness

An eval harness measures whether an agent or workflow is doing the right thing. In software engineering, this can include:

- Running tests
- Checking lint or type errors
- Comparing diffs
- Replaying known tasks
- Tracking whether an agent follows constraints

Coder Studio is not a benchmark platform. Its value is closer to an operator harness: it makes the live execution loop easier to inspect, verify, and resume.

## Human-In-The-Loop

Human-in-the-loop means the AI can do work, but the human remains responsible for review and decisions.

Coder Studio keeps the human close to the loop by showing:

- What the agent said
- What commands ran
- What files changed
- What Git diff exists
- What terminal output proved or disproved the result

## Local-First Vibe Coding

Local-first vibe coding keeps the development environment on your own machine. Coder Studio runs locally and opens local project folders, while provider CLIs such as Claude Code or Codex run according to their own configuration.

This is different from a hosted cloud IDE. You can still expose Coder Studio through Tailscale, ngrok, or Cloudflare Tunnel, but the development runtime remains yours.

## Where Coder Studio Fits

Coder Studio is best described as:

```text
local-first agentic coding workspace
```

or:

```text
browser-based harness for Claude Code and Codex sessions
```

It is for developers who want the speed of natural-language vibe coding without losing the engineering surfaces that make work reviewable: files, Git, terminals, sessions, and verification.

## References

- [Vibe coding overview](https://en.wikipedia.org/wiki/Vibe_coding)
- [ngrok HTTP Endpoints](https://ngrok.com/docs/http/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
