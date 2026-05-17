# Agentic Workspace Platform Design

> Status: Draft
> Date: 2026-05-17
> Scope: Positioning, provider platform architecture, workspace intelligence, agent instructions, custom agent onboarding, session review, context attach, and future provider presets.

## Goal

Evolve Coder Studio from a Claude Code and Codex browser workspace into an agent-agnostic workspace platform for real development.

The product should support Claude Code and Codex today, while making the architecture, UI, docs, and future roadmap clearly compatible with more coding agents and user-defined agent commands.

## Positioning

Primary slogan stays:

```text
Coder Studio, made for vibe coding.
```

Chinese:

```text
Coder Studio，生来就是 vibe coding。
```

Category positioning becomes:

```text
An agentic workspace for real development.
```

Chinese:

```text
面向真实开发的 agentic workspace。
```

One-line product description:

```text
Run, inspect, and supervise coding agents with terminals, files, Git, sessions, and review in one browser workspace.
```

Chinese:

```text
用一个浏览器工作区运行、检查和监督 coding agent，把终端、文件、Git、会话和代码审查放在一起。
```

`local-first` remains a secondary trust and control message. It should not be the main headline. Use it in supporting copy such as:

```text
Your code and runtime stay on your machine.
```

## Product Thesis

Raw vibe coding is fast, but real development still needs surrounding engineering surfaces:

- project context
- terminal output
- files and diffs
- verification commands
- session state
- review
- safety rules
- cross-device visibility

Coder Studio should become the workspace around coding agents, not a single-agent wrapper.

The long-term product promise:

```text
Bring any coding agent into one workspace.
```

Chinese:

```text
把任何 coding agent 接入同一个工作区。
```

## Competitive Frame

Warp is best framed as an agentic terminal and agentic development environment. Coder Studio should not compete by rebuilding Warp's terminal from scratch.

Coder Studio should differentiate as:

```text
Warp is the agentic terminal. Coder Studio is the agentic workspace.
```

The practical distinction:

- Warp starts from the terminal and grows into agentic development.
- Coder Studio starts from the browser workspace and grows into agent orchestration, inspection, review, and cross-device supervision.

## Strategic Non-Goals

The following items are intentionally out of scope for this roadmap:

- GitHub clone onboarding.
- A new "continue recent workspace" flow; existing restore behavior already covers this.
- Claude/Codex install diagnosis as a primary feature; provider availability can stay in existing runtime status surfaces.
- A full Warp-like terminal rewrite.
- Cloud agent orchestration.
- Enterprise admin features.
- Large template libraries with weak value.

## Core Concepts

### Agent Provider

An Agent Provider describes how Coder Studio can launch, display, configure, and reason about a coding agent.

Existing Claude Code and Codex support already use `ProviderDefinition`. The roadmap should productize this internal concept and extend it carefully rather than introduce a parallel abstraction.

Provider metadata should eventually describe:

- identity: `id`, `displayName`, `badge`
- launch behavior: command, args, cwd, env
- configuration schema
- required commands
- capabilities
- idle/status heuristics
- install or documentation hints
- supervisor support
- context attach compatibility

### Provider Types

Use three product levels:

| Type | Meaning | Examples |
|---|---|---|
| Built-in Provider | Maintained in the repo and supported directly | Claude Code, Codex |
| Preset Provider | Pre-filled command configuration that users can enable | Gemini CLI, Aider, OpenCode |
| Custom Provider | User-defined command-based agent | internal CLI, local script, company agent |

### Workspace Intelligence

Workspace Intelligence is the project understanding layer. It detects project facts and turns them into useful context for humans and agents.

It should detect:

- whether the workspace is a Git repository
- package manager
- framework family
- important scripts
- recommended dev/test/build/lint commands
- README and documentation entry points
- whether `AGENTS.md` exists

### Agent Instructions

Agent Instructions are project-level working rules, stored in `AGENTS.md` by default.

The generated instructions should include:

- project overview
- development commands
- test/build/lint commands
- code style hints
- review expectations
- safety rules
- provider-specific notes when needed

The feature must be universal. It should not be named after Claude Code or Codex.

### Agent Session

An Agent Session is a provider-backed terminal or command run plus metadata about its objective, state, workspace, baseline, changes, verification, and context.

The current `Session` model already has the important base fields: `providerId`, `workspaceId`, `terminalId`, `state`, `title`, and timestamps. The roadmap should extend this model in small steps instead of replacing it.

### AI Change Review

AI Change Review is the product loop that turns generated code into inspectable work.

The target experience:

- start an agent session
- capture a Git baseline
- inspect files changed since session start
- view diffs beside the session
- attach diff or terminal output back to an agent
- record verification commands
- produce a review summary

This becomes the strongest product promise:

```text
Vibe coding you can inspect.
```

Chinese:

```text
可检查的 vibe coding。
```

### Context Attach

Context Attach lets visible workspace artifacts become agent input:

- file
- selection
- Git diff
- terminal output
- test failure
- project summary
- `AGENTS.md`
- session transcript

Actions should be provider-agnostic:

- send to selected agent
- send to another agent
- attach to new session
- attach to existing session

## User Journeys

### New Project Review

1. User opens a local project.
2. Coder Studio detects Git, package manager, scripts, framework, and instruction state.
3. User sees a compact project summary.
4. User creates or updates `AGENTS.md`.
5. User launches a provider session.
6. Coder Studio records the session baseline.
7. User reviews changed files and verification results.

### Bring Your Own Agent

1. User opens Agent Providers settings.
2. User creates a custom command provider.
3. User gives it a display name, command, args, cwd mode, and capabilities.
4. Coder Studio validates the command shape without trying to diagnose every vendor-specific auth flow.
5. The custom provider appears beside built-in providers.
6. User launches a session with that provider.

### One Agent Writes, Another Reviews

1. User asks Claude Code to implement a change.
2. Coder Studio captures changed files since the Claude session baseline.
3. User sends the diff to Codex or another provider for review.
4. The reviewing agent reports risks, missing tests, and improvement suggestions.
5. User applies follow-up changes and verifies.

## Phase Breakdown

The roadmap is split into eight implementation plans:

1. Positioning and docs.
2. Provider Registry productization.
3. Workspace Intelligence.
4. Agent Instructions.
5. Custom Agent MVP.
6. Agent Session metadata foundation.
7. AI Change Review.
8. Context Attach and Provider Presets.

## Success Criteria

The roadmap is successful when:

- README and Wiki clearly describe Coder Studio as an agentic workspace, not only a Claude/Codex wrapper.
- Claude Code and Codex are represented through a provider platform shape.
- Project facts can be summarized and reused by UI and agent flows.
- Users can create and edit `AGENTS.md` from the workspace.
- Users can define a simple command-based custom agent.
- Sessions can be tied to changed files and verification state.
- Diffs, terminal output, and project context can be sent to selected agents.
- Future provider presets can be added without large UI rewrites.

## Risks

| Risk | Mitigation |
|---|---|
| Product positioning becomes too abstract | Keep `made for vibe coding` as slogan and explain concrete surfaces: files, terminal, Git, review |
| Provider abstraction grows too large | Extend existing `ProviderDefinition` in phases |
| Custom agents become impossible to support | Start with command-based PTY and one-shot modes only |
| Review flow overpromises attribution | Start with Git baseline and changed files; avoid claiming perfect causal attribution |
| Workspace Intelligence becomes a passive dashboard | Feed its output into `AGENTS.md`, review, and context attach |

## Verification Strategy

Each implementation phase must include:

- unit tests for new domain functions
- command tests for server APIs
- focused React tests for new surfaces
- docs verification with `git diff --check`
- manual smoke test for the relevant workspace flow when UI changes are present

