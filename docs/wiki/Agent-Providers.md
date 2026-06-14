# Agent Providers

Agent providers are the coding-agent runtimes that Coder Studio can launch inside the workspace.

The important idea is that the workspace should not be defined by only one vendor or one CLI forever. Providers can change over time. The workspace surfaces around them should stay useful.

## Built-In Providers Today

Current built-in support covers:

- Claude Code (`claude`) - full capability, stable
- Codex (`codex`) - full capability, stable
- Gemini CLI (`gemini`) - full capability, stable
- Cursor Agent (`agent`) - full capability, stable
- OpenCode (`opencode`) - limited capability, experimental

These providers run through their local CLIs, and Coder Studio gives them a browser workspace with terminals, files, Git, sessions, and review surfaces around the run.

Full capability means Coder Studio can run interactive sessions, use idle detection, and use the provider for supervisor/session-analysis style workflows. Limited capability means interactive sessions are supported, but not every automated workflow is wired up yet.

## Install Provider CLIs

Provider CLIs need local installation. Coder Studio does not bundle these CLIs; it launches the provider commands available on your machine.

### Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Verify after installation:

```bash
claude --version
```

### Install Codex

```bash
npm install -g @openai/codex
```

Verify after installation:

```bash
codex --version
```

### Install Gemini CLI

```bash
npm install -g @google/gemini-cli
```

Verify after installation:

```bash
gemini --version
```

### Install Cursor Agent

Cursor publishes its agent CLI through the Cursor install script on macOS and Linux:

```bash
curl https://cursor.com/install -fsS | bash
```

Verify after installation:

```bash
agent --version
```

### Install OpenCode

```bash
npm install -g opencode-ai
```

Verify after installation:

```bash
opencode --version
```

## Verify PATH

Coder Studio can only launch provider commands that are visible to the server process PATH. Verify the command in a normal terminal first:

```bash
which claude
which codex
which gemini
which agent
which opencode
claude --version
codex --version
gemini --version
agent --version
opencode --version
```

If `which` cannot find the command, your global npm command directory is probably not in PATH.

Check the global npm prefix:

```bash
npm config get prefix
npm prefix -g
```

On macOS/Linux, global command shims are usually under `<prefix>/bin`. Add that directory to your shell profile, open a new terminal, and restart Coder Studio:

```bash
coder-studio serve --restart
```

On Windows, also check that the global npm command directory is in the user or system PATH. A common location is `%APPDATA%\npm`.

## Why Provider-Agnostic Positioning Matters

Coder Studio is not trying to become a wrapper for exactly one agent CLI or vendor.

The longer-term product promise is simpler:

- keep the workspace useful even as agent tools change
- let users compare or supervise different agents in one place
- avoid rebuilding the whole product story around a single provider brand

That positioning does not mean every CLI agent has identical support. It means the workspace direction is broader than any single provider brand.

## Presets And Custom Providers

Preset metadata exists for CLI agents that can be launched through the custom-provider flow. Presets are separate from the built-in provider registry.

Preset/custom-provider workflows are useful when you want to launch a CLI through custom command configuration instead of the built-in provider path. Current preset examples include:

- Gemini CLI
- Aider
- OpenCode

Gemini CLI and OpenCode also have built-in providers today; prefer the built-in entries unless you specifically need custom-provider behavior. Aider is not a built-in provider today. Treat Aider as a preset/custom-provider workflow: install the `aider` command yourself, create or apply the provider metadata, and verify the command is visible in PATH before starting a session.

## Custom Command Providers

Custom command providers let users connect their own local coding-agent commands to the same workspace model. That can cover Aider, internal tools, local scripts, or company-specific agents.

Custom providers are interactive command integrations. They may not support the same supervisor, idle-detection, agent-instructions, or install flows as built-in providers.

## Non-Goals

The provider roadmap does not imply:

- a provider marketplace today
- cloud agent orchestration
- vendor-specific OAuth or auth setup flows
- deep install diagnosis for every agent tool
- a promise that every provider will support identical capabilities on day one

## Current Reality

If you are using Coder Studio today, the accurate summary is:

- built-in providers today are Claude Code, Codex, Gemini CLI, Cursor Agent, and OpenCode
- Aider-style workflows use preset/custom-provider configuration rather than the built-in registry
- your code and runtime still stay on your own machine
