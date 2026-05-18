# Agentic Workspace Phase 1 Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Reposition Coder Studio as an agentic workspace for real development while preserving the current vibe coding slogan.

**Architecture:** Documentation-only phase. Update README and Wiki copy so the product is no longer framed as only a Claude Code and Codex workspace, while still naming current supported providers accurately.

**Tech Stack:** Markdown, GitHub README/Wiki docs.

---

## Scope

Includes:

- README positioning update.
- Chinese README positioning update.
- Wiki positioning updates.
- New Wiki page explaining agentic workspace.
- New Wiki page explaining provider-agnostic roadmap.
- New Wiki page comparing Coder Studio and Warp.

Excludes:

- Code changes.
- Custom provider implementation.
- Provider settings UI changes.
- Clone GitHub onboarding.
- Continue recent workspace onboarding.
- Claude/Codex install diagnosis.

## Files

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/wiki/Home.md`
- Modify: `docs/wiki/Why-Coder-Studio.md`
- Modify: `docs/wiki/README.md`
- Create: `docs/wiki/What-is-an-Agentic-Workspace.md`
- Create: `docs/wiki/Agent-Providers.md`
- Create: `docs/wiki/Coder-Studio-vs-Warp.md`

## Tasks

- [ ] Update README hero copy to use:

```text
Coder Studio, made for vibe coding.

An agentic workspace for real development. Run, inspect, and supervise coding agents with terminals, files, Git, sessions, and review in one browser workspace.
```

- [ ] Update Chinese README hero copy to use:

```text
Coder Studio，生来就是 vibe coding。

面向真实开发的 agentic workspace。用一个浏览器工作区运行、检查和监督 coding agent，把终端、文件、Git、会话和代码审查放在一起。
```

- [ ] Replace narrow Claude/Codex-only framing with "Claude Code and Codex today, more coding agents over time" where appropriate.
- [ ] Keep feature bullets concrete: terminal, files, Git, sessions, review, cross-device.
- [ ] Move `local-first` into secondary trust copy such as "Your code and runtime stay on your machine."
- [ ] Create `What-is-an-Agentic-Workspace.md` covering definition, why terminal/editor alone is not enough, and why review matters.
- [ ] Create `Agent-Providers.md` covering built-in providers, future presets, custom command providers, and non-goals.
- [ ] Create `Coder-Studio-vs-Warp.md` with the frame: "Warp is the agentic terminal. Coder Studio is the agentic workspace."
- [ ] Update `docs/wiki/README.md` with the new pages.

## Acceptance Criteria

- README does not make Coder Studio sound limited to only Claude Code and Codex.
- README still accurately says current built-in support is Claude Code and Codex.
- Wiki contains a clear provider-agnostic roadmap.
- `local-first` is present as a supporting trust message, not as the headline.

## Verification

```bash
git diff --check -- README.md README.zh-CN.md docs/wiki
```

Expected: no whitespace errors.

## Suggested Commit

```bash
git add README.md README.zh-CN.md docs/wiki
git commit -m "docs: position coder studio as agentic workspace"
```

