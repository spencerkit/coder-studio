# Agent Providers

Agent providers are the coding-agent runtimes that Coder Studio can launch inside the workspace.

The important idea is that the workspace should not be defined by only one vendor or one CLI forever. Providers can change over time. The workspace surfaces around them should stay useful.

## Built-In Providers Today

Current built-in support covers:

- Claude Code
- OpenAI Codex

These are the providers available in today's product. They run through their local CLIs, and Coder Studio gives them a browser workspace with terminals, files, Git, sessions, and review surfaces around the run.

## Why Provider-Agnostic Positioning Matters

Coder Studio is not trying to become a wrapper for exactly two agent CLIs forever.

The longer-term product promise is simpler:

- keep the workspace useful even as agent tools change
- let users compare or supervise different agents in one place
- avoid rebuilding the whole product story around a single provider brand

That positioning does not mean every provider already exists in the product. It means the workspace direction is broader than today's built-in list.

## Future Presets

Future preset providers are roadmap items, not current built-in support.

The idea is to offer pre-filled provider metadata for common coding-agent tools so users do not have to start from scratch when support expands. Example preset candidates include:

- Gemini CLI
- Aider
- OpenCode

This page is not claiming that those providers are already enabled today.

## Custom Command Providers

Custom command providers are also a roadmap item.

The goal is to let users connect their own local coding-agent commands to the same workspace model. That could cover internal tools, local scripts, or company-specific agents.

Custom command providers are not part of the current built-in release.

## Non-Goals

The provider roadmap does not imply:

- a provider marketplace today
- cloud agent orchestration
- vendor-specific OAuth or auth setup flows
- deep install diagnosis for every agent tool
- a promise that every provider will support identical capabilities on day one

## Current Reality

If you are using Coder Studio today, the accurate summary is:

- built-in providers today are Claude Code and OpenAI Codex
- the workspace direction is broader than those two providers
- your code and runtime still stay on your own machine
