# Growth Launch Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Coder Studio growth launch package so new GitHub/npm visitors understand the product quickly, complete a first trial, and have clear Chinese and English launch materials.

**Architecture:** This is a docs, metadata, and launch-content implementation. GitHub and npm landing pages become the top of the funnel, Chinese `docs/help` pages support the Chinese validation phase, English `docs/wiki` pages support the global launch phase, and `.github` templates turn launch feedback into structured issues.

**Tech Stack:** Markdown, GitHub README rendering, GitHub issue forms YAML, npm package metadata, existing pnpm verification commands.

---

## Scope Check

The approved spec covers one launch system, not product code. It spans several content surfaces, but they are coupled by the same first-run funnel:

1. GitHub/npm visitor understands the product.
2. Visitor installs and opens a workspace.
3. Visitor runs the first Claude or Codex session.
4. Visitor understands Git diff review and mobile continuation.
5. Visitor has clear docs and issue templates when blocked.
6. Maintainer has Chinese and English launch posts ready.

Keep this as one plan because each task produces a launch asset that supports the same growth release. Do not add large product features during this implementation.

## File Structure

- `README.md`: English GitHub landing page. It should point English readers to English wiki pages for deeper docs.
- `README.zh-CN.md`: Chinese GitHub landing page. It should point Chinese readers to `docs/help/*`.
- `packages/cli/README.md`: npm package landing page. It should be concise and route users to GitHub README, English wiki, and Chinese help docs.
- `packages/cli/package.json`: npm description and keywords that match the launch positioning.
- `docs/help/README.md`: Chinese help index.
- `docs/help/first-agent-run.md`: Chinese first successful agent session guide.
- `docs/help/quick-start.md`: Chinese quick-start entry; link to first agent run and troubleshooting.
- `docs/help/providers.md`: Chinese Provider CLI setup; add PATH and verification details.
- `docs/help/troubleshooting.md`: Chinese first-run troubleshooting.
- `docs/help/mobile-guide.md`: Chinese mobile and remote guide; clarify mobile use boundaries.
- `docs/help/known-limitations.md`: Chinese known limitations.
- `docs/wiki/README.md`: English wiki source index.
- `docs/wiki/Home.md`: English wiki home page.
- `docs/wiki/Quick-Start.md`: English quick-start entry; link to first agent run and troubleshooting.
- `docs/wiki/First-Agent-Run.md`: English first successful agent session guide.
- `docs/wiki/Agent-Providers.md`: English Provider CLI setup; add PATH and verification details.
- `docs/wiki/Troubleshooting.md`: English first-run troubleshooting.
- `docs/wiki/Mobile-and-Remote-Access.md`: English mobile and remote guide; clarify mobile use boundaries.
- `docs/wiki/Security-and-Privacy.md`: English security page; ensure launch-safe claims.
- `docs/wiki/Known-Limitations.md`: English known limitations.
- `CONTRIBUTING.md`: Lightweight contribution and feedback guide for new external users.
- `.github/ISSUE_TEMPLATE/config.yml`: GitHub issue template chooser config.
- `.github/ISSUE_TEMPLATE/installation.yml`: Structured installation issue report.
- `.github/ISSUE_TEMPLATE/provider-setup.yml`: Structured Provider CLI issue report.
- `.github/ISSUE_TEMPLATE/feature-request.yml`: Structured feature request.
- `.github/ISSUE_TEMPLATE/workflow-showcase.yml`: Structured workflow share template.
- `docs/promotion/growth-launch-2026-06.zh-CN.md`: Chinese long-form launch post.
- `docs/promotion/growth-launch-2026-06.en.md`: English launch post variants.
- `docs/promotion/social-posts-2026-06.md`: Chinese and English short post copy.
- `docs/promotion/launch-faq-2026-06.md`: FAQ content for launch comments.
- `docs/promotion/growth-launch-checklist-2026-06.md`: Final launch verification checklist.
- `docs/promotion/releases/README.md`: Add the growth launch content pack to the promotion release index.

## Task 1: Landing Page And npm Positioning

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Capture the current landing-page link targets**

Run:

```bash
rg -n "Documentation|Quick Start|docs/help|docs/wiki|demo|Watch|View Workspace" README.md README.zh-CN.md packages/cli/README.md
```

Expected: current links show that the English README still points several documentation links at `docs/help/*`, which are primarily Chinese.

- [ ] **Step 2: Update `packages/cli/package.json` metadata**

Change the package description and keywords to match the launch positioning:

```json
"description": "Self-hosted browser workspace for AI coding agents, review, supervision, and cross-device continuation.",
```

Replace the existing `keywords` array with:

```json
[
  "ai-coding",
  "ai-agent",
  "agent-workspace",
  "browser-ide",
  "claude-code",
  "codex",
  "self-hosted",
  "cross-device",
  "terminal",
  "git"
]
```

- [ ] **Step 3: Refresh the top of `README.md`**

Keep the logo, project name, badges, preview image, feature tables, and lower sections. Replace the short positioning copy below `# Coder Studio` with this content:

```markdown
**Self-hosted browser workspace for AI coding agents.**

Coder Studio brings Claude Code, Codex, terminals, files, Git diff review, Supervisor loops, Work Analysis, and Skills into one browser workspace you run on your own machine.

Use it when raw terminal-only AI coding starts to feel scattered: start an agent task on desktop, review the changed files and diff beside the session, monitor long-running work, and reopen the same workspace from a tablet or phone.

Works with popular coding agents including Claude Code, Codex, Gemini CLI, Cursor Agent, OpenCode, and Aider-style CLI agents.
```

Replace the CTA row near the top with:

```markdown
[Watch Demo](docs/assets/demo.mp4) · [Quick Start](#quick-start) · [English Docs](docs/wiki/Quick-Start.md) · [Star on GitHub](https://github.com/spencerkit/coder-studio)

[中文说明](README.zh-CN.md) | [Security & Privacy](docs/wiki/Security-and-Privacy.md) | [Known Limitations](docs/wiki/Known-Limitations.md)
```

Add this block between the workspace preview and `## Why Coder Studio?`:

```markdown
## What You Can Try In 5 Minutes

1. Install with `npm install -g @spencer-kit/coder-studio`.
2. Launch with `coder-studio open`.
3. Open one local repository.
4. Start a Claude or Codex session.
5. Ask the agent for a small change, then review the Git diff beside the session.
6. Reopen the same workspace from a tablet or phone to check progress.

Coder Studio is not a cloud IDE, not a VS Code replacement, and not an AI model provider. It is a self-hosted workbench around the AI coding agents and local tools you already use.
```

In the Documentation table, route English readers to wiki pages:

```markdown
| Resource | Description |
|----------|-------------|
| [Quick Start](docs/wiki/Quick-Start.md) | Install, launch, and open your first workspace |
| [First Agent Run](docs/wiki/First-Agent-Run.md) | Run Claude or Codex, inspect output, and review Git diff |
| [Agent Providers](docs/wiki/Agent-Providers.md) | Install and verify coding agent CLIs |
| [Mobile and Remote Access](docs/wiki/Mobile-and-Remote-Access.md) | LAN, Tailscale, ngrok, Cloudflare Tunnel, and phone/tablet usage |
| [Security and Privacy](docs/wiki/Security-and-Privacy.md) | Local-first model, provider boundaries, and remote access risks |
| [Known Limitations](docs/wiki/Known-Limitations.md) | Current requirements and product boundaries |
| [Troubleshooting](docs/wiki/Troubleshooting.md) | First-run problems, Provider CLI issues, and service recovery |
| [Chinese Help Center](docs/help/README.md) | 中文帮助中心 |
```

- [ ] **Step 4: Refresh the top of `README.zh-CN.md`**

Keep the logo, project name, badges, preview image, feature tables, and lower sections. Replace the short positioning copy below `# Coder Studio` with:

```markdown
**自部署的 AI Coding 工作台。**

Coder Studio 把 Claude Code、Codex、终端、文件、Git diff 审查、Supervisor 监督循环、工作分析和 Skills 放进同一个浏览器 workspace，并运行在你自己的机器上。

当纯终端里的 AI coding 开始变得分散时，可以用它在桌面端启动 Agent 任务，在会话旁审查改动和 diff，监督长任务进度，并从平板或手机重新打开同一个工作区继续查看。

支持 Claude Code、Codex、Gemini CLI、Cursor Agent、OpenCode，以及 Aider 这类 CLI coding agent。
```

Replace the CTA row near the top with:

```markdown
[观看 Demo](docs/assets/demo.mp4) · [快速开始](#快速开始) · [中文帮助中心](docs/help/README.md) · [GitHub Star](https://github.com/spencerkit/coder-studio)

[English](README.md) | [安全与隐私](docs/wiki/Security-and-Privacy.md) | [当前限制](docs/help/known-limitations.md)
```

Add this block between the workspace preview and `## 为什么选择 Coder Studio？`:

```markdown
## 5 分钟可以试到什么

1. 使用 `npm install -g @spencer-kit/coder-studio` 安装。
2. 使用 `coder-studio open` 启动。
3. 打开一个本地代码仓库。
4. 创建 Claude 或 Codex 会话。
5. 让 Agent 做一个小改动，然后在 Git diff 里审查结果。
6. 用平板或手机重新打开同一个 workspace 查看进度。

Coder Studio 不是云 IDE，不是 VS Code 替代品，也不是 AI 模型提供方。它是围绕你已经在使用的 AI coding agent 和本地开发工具搭建的自部署工作台。
```

Update the Chinese documentation table to include:

```markdown
| 资源 | 描述 |
|------|------|
| [快速开始](docs/help/quick-start.md) | 安装、启动和打开第一个 workspace |
| [第一次 Agent 运行](docs/help/first-agent-run.md) | 创建 Claude/Codex 会话、查看输出并审查 Git diff |
| [Provider 配置](docs/help/providers.md) | 安装和验证 coding agent CLI |
| [移动端与远程访问](docs/help/mobile-guide.md) | 局域网、Tailscale、ngrok、Cloudflare Tunnel 和手机/平板使用 |
| [当前限制](docs/help/known-limitations.md) | 当前要求、边界和适用场景 |
| [故障排除](docs/help/troubleshooting.md) | 首次运行、Provider、端口、认证和服务恢复 |
| [English Wiki](docs/wiki/README.md) | 英文 Wiki 源页面 |
```

- [ ] **Step 5: Replace `packages/cli/README.md` with the npm landing copy**

Use this complete file:

````markdown
# @spencer-kit/coder-studio

Self-hosted browser workspace for AI coding agents, review, supervision, and cross-device continuation.

Coder Studio runs on your machine and opens your local projects in a browser workspace. It brings Claude Code, Codex, terminals, files, Git diff review, Supervisor loops, Work Analysis, and Skills into one place.

## Install

```bash
npm install -g @spencer-kit/coder-studio
```

Coder Studio requires Node.js 24 or newer.

## Quick Start

```bash
coder-studio open
```

Then:

1. Open a local repository.
2. Start a Claude or Codex session.
3. Ask the agent for a small change.
4. Review the changed files and Git diff beside the session.
5. Reopen the same workspace from another device when you want to monitor progress.

## Provider CLIs

Coder Studio does not bundle AI models. Install the local CLI for the agent you want to run:

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
```

After installation, verify:

```bash
claude --version
codex --version
```

## More Information

- GitHub README: https://github.com/spencerkit/coder-studio#readme
- English Quick Start: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/Quick-Start.md
- First Agent Run: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/First-Agent-Run.md
- Security and Privacy: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/Security-and-Privacy.md
- 中文帮助中心: https://github.com/spencerkit/coder-studio/blob/main/docs/help/README.md

## What It Is Not

- Not a cloud IDE.
- Not a VS Code replacement.
- Not an AI model provider.
- Not a promise that phone screens replace desktop coding.

Coder Studio is a workbench around local repositories, local shells, and the AI coding agent CLIs you choose to install.

## License

MIT
````

- [ ] **Step 6: Verify landing-page links and metadata**

Run:

```bash
rg -n "docs/help/(quick-start|providers|mobile-guide|troubleshooting)" README.md
rg -n "docs/wiki/(Quick-Start|First-Agent-Run|Agent-Providers|Mobile-and-Remote-Access|Security-and-Privacy|Known-Limitations|Troubleshooting)" README.md packages/cli/README.md
node -e "const p=require('./packages/cli/package.json'); console.log(p.description); console.log(p.keywords.join(','))"
```

Expected:

- first command exits with no matches for the English README
- second command prints the expected English wiki links
- third command prints the new self-hosted description and launch keywords

- [ ] **Step 7: Run formatting and diff checks**

Run:

```bash
git diff --check
pnpm ci:lint
```

Expected: both commands pass.

- [ ] **Step 8: Commit landing-page changes**

Run:

```bash
git add README.md README.zh-CN.md packages/cli/README.md packages/cli/package.json
git commit -m "docs: refresh launch landing pages"
```

## Task 2: First Agent Run Guides

**Files:**
- Create: `docs/help/first-agent-run.md`
- Create: `docs/wiki/First-Agent-Run.md`
- Modify: `docs/help/README.md`
- Modify: `docs/help/quick-start.md`
- Modify: `docs/wiki/README.md`
- Modify: `docs/wiki/Home.md`
- Modify: `docs/wiki/Quick-Start.md`

- [ ] **Step 1: Create the Chinese first-run guide**

Create `docs/help/first-agent-run.md` with this content:

````markdown
# 第一次 Agent 运行

这篇文档带你完成第一次有效的 Coder Studio Agent 会话：打开项目、创建 Claude 或 Codex 会话、观察输出，并在 Git diff 中审查改动。

## 这篇文档解决什么问题

快速验证 Coder Studio 是否已经可以承接真实 AI coding 工作流，而不只是打开界面。

## 前置条件

- 已安装 Coder Studio：`npm install -g @spencer-kit/coder-studio`
- Node.js 版本为 24 或更新：`node --version`
- 至少安装一个 Provider CLI：
  - Claude Code：`npm install -g @anthropic-ai/claude-code`
  - Codex：`npm install -g @openai/codex`
- Provider CLI 可以在普通终端中执行：
  - `claude --version`
  - `codex --version`

## 1. 启动 Coder Studio

```bash
coder-studio open
```

浏览器会自动打开。如果没有自动打开，先执行：

```bash
coder-studio status
```

然后手动访问命令输出里的本地地址。

## 2. 打开一个本地项目

在欢迎页点击 **打开工作区**，选择一个你可以安全试验的小型仓库。

建议第一次选择：

- 有 README 的个人项目
- 有 Git 仓库历史的项目
- 不包含生产密钥或敏感配置的项目

## 3. 创建 Claude 或 Codex 会话

进入工作区后，点击 **创建会话**，选择 Claude 或 Codex。

如果 Provider 显示未安装：

1. 回到普通终端安装对应 CLI。
2. 用 `claude --version` 或 `codex --version` 验证。
3. 刷新 Coder Studio 页面或重新打开工作区。

## 4. 使用一个安全的小任务

第一次运行不要让 Agent 直接做大规模重构。建议使用这个任务：

```text
请阅读 README，补充一小段“本项目适合谁使用”的说明。改动保持在 1-2 段内，不要改代码。
```

这个任务适合第一次验证，因为：

- 改动范围小
- Git diff 容易审查
- 即使结果不理想也容易回滚

## 5. 查看输出和文件变化

会话运行时，观察 Agent 面板里的输出。任务结束后：

1. 打开 Git 视图。
2. 查看 changed files。
3. 打开 diff。
4. 判断改动是否符合你的要求。

如果你不满意，可以继续在同一个 Agent 会话中要求它调整，也可以直接手动编辑文件。

## 6. 在移动端查看进度

如果你想用手机或平板查看进度，先阅读 [移动端与远程访问指南](mobile-guide.md)。

移动端适合：

- 查看 Agent 是否还在运行
- 查看终端输出
- 浏览文件和 diff
- 监督长任务

移动端不适合作为第一次试用时的主力编辑环境。第一次 Agent 运行建议先在桌面端完成。

## 常见问题

**Q：没装 Claude 或 Codex 能不能试？**
可以打开工作区、浏览文件、使用终端，但不能创建对应 Agent 会话。

**Q：安装了 Provider 但 Coder Studio 仍然找不到？**
在普通终端执行 `which claude` 或 `which codex`。如果找不到，说明全局 npm bin 目录不在 PATH 中。按 [Provider 配置](providers.md) 排查。

**Q：Agent 改坏了怎么办？**
先看 Git diff。你可以手动编辑修正，也可以用 Git 丢弃不需要的改动。

## 下一步

- [Provider 配置](providers.md)
- [移动端与远程访问指南](mobile-guide.md)
- [排障指南](troubleshooting.md)
- [常见工作流](workflows.md)
````

- [ ] **Step 2: Create the English first-run guide**

Create `docs/wiki/First-Agent-Run.md` with this content:

````markdown
# First Agent Run

This guide walks through the first successful Coder Studio agent workflow: open a project, start Claude or Codex, watch the session output, and review the resulting Git diff.

## What This Guide Solves

Use this to verify that Coder Studio can support a real AI coding loop, not just launch the UI.

## Prerequisites

- Coder Studio installed: `npm install -g @spencer-kit/coder-studio`
- Node.js 24 or newer: `node --version`
- At least one Provider CLI installed:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`
  - Codex: `npm install -g @openai/codex`
- The Provider CLI works in a normal terminal:
  - `claude --version`
  - `codex --version`

## 1. Launch Coder Studio

```bash
coder-studio open
```

Your browser should open automatically. If it does not, run:

```bash
coder-studio status
```

Then manually open the local URL printed by the command.

## 2. Open A Local Project

On the welcome screen, choose **Open Workspace** and select a small repository you can safely test with.

For the first run, prefer:

- a personal repository with a README
- a Git repository with a clean working tree
- a project that does not contain production secrets

## 3. Start Claude Or Codex

Inside the workspace, create a new session and choose Claude or Codex.

If the provider is missing:

1. Install the CLI in your normal terminal.
2. Verify it with `claude --version` or `codex --version`.
3. Refresh Coder Studio or reopen the workspace.

## 4. Use A Safe First Task

Do not start with a large refactor. Use a small documentation task first:

```text
Please read the README and add a short "Who this is for" section. Keep the change to 1-2 paragraphs and do not modify source code.
```

This is a good first test because:

- the change is small
- the Git diff is easy to inspect
- the result is easy to revert

## 5. Review Output And Changes

While the session runs, watch the agent output. When it finishes:

1. Open the Git view.
2. Inspect changed files.
3. Open the diff.
4. Decide whether the result matches your request.

You can ask the same session for a follow-up change, edit the files yourself, or discard the change with Git.

## 6. Check Progress From Mobile

For phone or tablet access, read [Mobile and Remote Access](Mobile-and-Remote-Access.md).

Mobile is best for:

- checking whether an agent is still running
- reading terminal output
- browsing files and diffs
- monitoring long tasks

Use desktop for the first full trial. Mobile is a continuation and review surface, not the main heavy editing environment.

## FAQ

**Can I try Coder Studio without Claude or Codex installed?**
Yes. You can open workspaces, browse files, and use terminals, but you cannot start that provider's agent session.

**I installed a provider but Coder Studio cannot find it. What now?**
Run `which claude` or `which codex` in a normal terminal. If the command is missing, your global npm bin directory is probably not in PATH. See [Agent Providers](Agent-Providers.md).

**What if the agent makes a bad change?**
Review the Git diff first. You can edit the file, ask for a follow-up, or discard the change with Git.

## Next Steps

- [Agent Providers](Agent-Providers.md)
- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Troubleshooting](Troubleshooting.md)
- [Common Workflows](Common-Workflows.md)
````

- [ ] **Step 3: Update the Chinese help index**

In `docs/help/README.md`, change the "我是第一次使用" list to:

```markdown
1. [快速开始](quick-start.md) — 安装、启动、打开第一个 workspace
2. [第一次 Agent 运行](first-agent-run.md) — 创建 Claude/Codex 会话并审查 Git diff
3. [Provider 配置](providers.md) — 安装 Claude / Codex CLI
4. [排障指南](troubleshooting.md) — 遇到问题先看这里
5. [当前限制](known-limitations.md) — 了解当前要求和边界
```

- [ ] **Step 4: Link first-run guide from Chinese quick start**

In `docs/help/quick-start.md`, change the "下一步看什么" list to:

```markdown
- [第一次 Agent 运行](first-agent-run.md) — 完成第一个 Claude/Codex 会话并审查 diff
- [App 功能总览](app-overview.md) — 了解核心概念
- [桌面端使用指南](desktop-guide.md) — 熟悉桌面端操作
- [移动端使用指南](mobile-guide.md) — 在手机端访问和使用
- [排障指南](troubleshooting.md) — 解决 Node、Provider、端口和认证问题
```

- [ ] **Step 5: Update English wiki indexes**

In `docs/wiki/README.md`, add `First-Agent-Run.md` and `Known-Limitations.md` to the page list.

In `docs/wiki/Home.md`, add this block near the top:

```markdown
## Start Here

- [Quick Start](Quick-Start.md)
- [First Agent Run](First-Agent-Run.md)
- [Agent Providers](Agent-Providers.md)
- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Security and Privacy](Security-and-Privacy.md)
- [Known Limitations](Known-Limitations.md)
- [Troubleshooting](Troubleshooting.md)
```

In `docs/wiki/Quick-Start.md`, add this under the first launch instructions:

```markdown
After Coder Studio opens, continue with [First Agent Run](First-Agent-Run.md) to start Claude or Codex, inspect output, and review your first Git diff.
```

- [ ] **Step 6: Verify first-run guide links**

Run:

```bash
rg -n "first-agent-run|First-Agent-Run|known-limitations|Known-Limitations" docs/help docs/wiki README.md README.zh-CN.md
git diff --check
pnpm ci:lint
```

Expected: links appear in README/help/wiki indexes, diff check passes, lint passes.

- [ ] **Step 7: Commit first-run guides**

Run:

```bash
git add docs/help/first-agent-run.md docs/wiki/First-Agent-Run.md docs/help/README.md docs/help/quick-start.md docs/wiki/README.md docs/wiki/Home.md docs/wiki/Quick-Start.md
git commit -m "docs: add first agent run guides"
```

## Task 3: Provider Setup And First-Run Troubleshooting

**Files:**
- Modify: `docs/help/providers.md`
- Modify: `docs/help/troubleshooting.md`
- Modify: `docs/wiki/Agent-Providers.md`
- Modify: `docs/wiki/Troubleshooting.md`

- [ ] **Step 1: Add PATH diagnostics to Chinese Provider docs**

In `docs/help/providers.md`, add this section after the CLI install commands:

````markdown
## 验证 PATH

安装 Provider CLI 后，Coder Studio 只能识别当前服务进程 PATH 中能找到的命令。先在普通终端验证：

```bash
which claude
which codex
claude --version
codex --version
```

如果 `which` 找不到命令，常见原因是全局 npm bin 目录没有加入 PATH。

查看全局 npm bin 目录：

```bash
npm bin -g
```

把输出目录加入 shell 配置后，重新打开终端并重启 Coder Studio：

```bash
coder-studio serve --restart
```

Windows 用户还需要确认 npm 的全局安装目录在用户或系统 PATH 中。常见目录是 `%APPDATA%\npm`。
````

- [ ] **Step 2: Add first-run checklist to Chinese troubleshooting**

In `docs/help/troubleshooting.md`, add this section after "前置条件":

```markdown
## 首次运行快速排查

如果第一次试用没有顺利跑起来，按这个顺序排查：

1. `node --version` 确认 Node.js >= 24.0.0。
2. `coder-studio version` 确认 CLI 已安装。
3. `coder-studio status` 确认服务正在运行。
4. `coder-studio logs` 查看最近错误。
5. `which claude` 或 `which codex` 确认 Provider CLI 在 PATH 中。
6. `claude --version` 或 `codex --version` 确认 Provider CLI 可执行。
7. 如果浏览器打不开，手动访问 `coder-studio status` 输出的 URL。
8. 如果移动端打不开，确认服务监听 `0.0.0.0` 且防火墙允许该端口。

首次试用建议先在桌面端完成，不要一开始就通过公网隧道或手机端排查所有问题。
```

- [ ] **Step 3: Add Provider missing recovery to Chinese troubleshooting**

In the "Provider 未安装或不可用" section of `docs/help/troubleshooting.md`, replace the list with:

````markdown
1. 验证 Provider 是否已安装：
   ```bash
   which claude
   which codex
   claude --version
   codex --version
   ```
2. 如果未找到命令，按 [Provider 配置指南](providers.md) 安装或修复 PATH。
3. 如果普通终端能找到命令，但 Coder Studio 找不到，重启服务：
   ```bash
   coder-studio serve --restart
   ```
4. 如果仍不可用，查看日志：
   ```bash
   coder-studio logs
   ```
5. 提交问题时附上 Node 版本、Provider 版本、`which` 输出和日志片段。
````

- [ ] **Step 4: Add PATH diagnostics to English Provider docs**

In `docs/wiki/Agent-Providers.md`, add this section after provider install commands:

````markdown
## Verify PATH

Coder Studio can only launch provider commands that are visible to the server process PATH. Verify the command in a normal terminal first:

```bash
which claude
which codex
claude --version
codex --version
```

If `which` cannot find the command, your global npm bin directory is probably not in PATH.

Check the global npm bin directory:

```bash
npm bin -g
```

Add that directory to your shell profile, open a new terminal, and restart Coder Studio:

```bash
coder-studio serve --restart
```

On Windows, also check that the global npm directory is in the user or system PATH. A common location is `%APPDATA%\npm`.
````

- [ ] **Step 5: Add first-run checklist to English troubleshooting**

In `docs/wiki/Troubleshooting.md`, add this section near the top:

```markdown
## First-Run Checklist

If the first trial does not work, check in this order:

1. `node --version` confirms Node.js >= 24.0.0.
2. `coder-studio version` confirms the CLI is installed.
3. `coder-studio status` confirms the service is running.
4. `coder-studio logs` shows recent errors.
5. `which claude` or `which codex` confirms the Provider CLI is in PATH.
6. `claude --version` or `codex --version` confirms the Provider CLI can run.
7. If the browser does not open, manually visit the URL from `coder-studio status`.
8. If mobile cannot connect, confirm the service listens on `0.0.0.0` and your firewall allows the port.

Use desktop for the first full trial. Do not start by debugging public tunnels and phone access at the same time.
```

- [ ] **Step 6: Verify troubleshooting coverage**

Run:

```bash
rg -n "PATH|which claude|which codex|node --version|coder-studio status|coder-studio logs" docs/help/providers.md docs/help/troubleshooting.md docs/wiki/Agent-Providers.md docs/wiki/Troubleshooting.md
git diff --check
pnpm ci:lint
```

Expected: all four docs include first-run and PATH language; diff check and lint pass.

- [ ] **Step 7: Commit troubleshooting docs**

Run:

```bash
git add docs/help/providers.md docs/help/troubleshooting.md docs/wiki/Agent-Providers.md docs/wiki/Troubleshooting.md
git commit -m "docs: tighten first-run troubleshooting"
```

## Task 4: Mobile Boundaries, Security, And Known Limitations

**Files:**
- Modify: `docs/help/mobile-guide.md`
- Create: `docs/help/known-limitations.md`
- Modify: `docs/help/README.md`
- Modify: `docs/wiki/Mobile-and-Remote-Access.md`
- Modify: `docs/wiki/Security-and-Privacy.md`
- Create: `docs/wiki/Known-Limitations.md`
- Modify: `docs/wiki/README.md`
- Modify: `docs/wiki/Home.md`

- [ ] **Step 1: Add mobile usage boundaries to Chinese mobile guide**

In `docs/help/mobile-guide.md`, add this section after "选择访问方式":

```markdown
## 移动端适合什么

移动端的主要价值是延续桌面端已经启动的工作流：

- 查看 Agent 是否仍在运行
- 阅读终端输出和状态变化
- 浏览文件和 Git diff
- 检查 Supervisor 进度
- 在离开电脑后决定是否需要介入

移动端不应该被理解成完整替代桌面端的主力编码环境。第一次安装、Provider 配置、大规模文件编辑和复杂 Git 操作建议先在桌面端完成。
```

- [ ] **Step 2: Create Chinese known limitations**

Create `docs/help/known-limitations.md`:

````markdown
# 当前限制

这篇文档说明 Coder Studio 当前版本的要求、边界和不适合承诺的场景。

## 这篇文档解决什么问题

帮助新用户在试用前建立正确预期，避免把 Coder Studio 理解成云 IDE、VS Code 替代品或 AI 模型服务。

## 系统要求

- Node.js 24 或更新版本是必需的。
- Coder Studio 通过 npm 全局安装。
- AI Agent 会话依赖本机已安装的 Provider CLI。

## Provider 边界

Coder Studio 不内置 Claude、Codex 或其他模型。它负责在工作区中启动和管理本地 Provider CLI。

如果没有安装 Provider CLI：

- 可以打开 workspace
- 可以浏览文件
- 可以使用终端
- 不能创建对应的 Agent 会话

## 移动端边界

移动端适合查看、监控和审查，不适合作为第一次试用或重度编码的主力入口。

推荐移动端使用场景：

- 查看长任务进度
- 阅读 Agent 输出
- 浏览文件
- 查看 Git diff
- 判断是否需要回到桌面端介入

## 远程访问边界

Coder Studio 默认更适合本机或可信网络访问。跨设备或公网访问需要你自己配置网络和认证。

远程访问前应当：

```bash
coder-studio config --password <强密码>
coder-studio config --host 0.0.0.0
coder-studio serve --restart
```

不要把无密码的 Coder Studio 暴露到公网。

## 当前不主打的能力

当前增长发布阶段不主打：

- 云端托管工作区
- 多人团队权限系统
- 手机端完整编码替代桌面端
- 插件市场
- 会话回放
- 偏好云同步

这些方向可能以后会演进，但不是第一次试用 Coder Studio 的核心价值。

## 下一步

- [快速开始](quick-start.md)
- [第一次 Agent 运行](first-agent-run.md)
- [移动端与远程访问指南](mobile-guide.md)
- [排障指南](troubleshooting.md)
````

- [ ] **Step 3: Add mobile usage boundaries to English mobile guide**

In `docs/wiki/Mobile-and-Remote-Access.md`, add this section near the top:

```markdown
## What Mobile Is Best For

Mobile is a continuation surface for work that usually starts on desktop:

- check whether an agent is still running
- read terminal output and status changes
- browse files and Git diffs
- inspect Supervisor progress
- decide whether you need to return to desktop and intervene

Mobile should not be positioned as a full replacement for desktop coding. Use desktop for first installation, Provider setup, large edits, and complex Git operations.
```

- [ ] **Step 4: Create English known limitations**

Create `docs/wiki/Known-Limitations.md`:

````markdown
# Known Limitations

This page sets expectations for the current Coder Studio release.

## What This Page Solves

Coder Studio is easiest to understand when its boundaries are explicit. It is not a cloud IDE, not a VS Code replacement, and not an AI model provider.

## System Requirements

- Node.js 24 or newer is required.
- Coder Studio is installed as a global npm package.
- Agent sessions depend on local Provider CLIs installed on your machine.

## Provider Boundary

Coder Studio does not bundle Claude, Codex, or other models. It launches and manages local Provider CLIs inside the workspace.

Without a Provider CLI installed, you can:

- open a workspace
- browse files
- use terminals

You cannot create that provider's agent session until the CLI is installed and visible in PATH.

## Mobile Boundary

Mobile is best for monitoring and review, not heavy editing.

Good mobile use cases:

- check long-running task progress
- read agent output
- browse files
- inspect Git diffs
- decide whether desktop intervention is needed

## Remote Access Boundary

Coder Studio is safest on localhost or trusted networks. Cross-device and public access require your own network and authentication setup.

Before remote access:

```bash
coder-studio config --password <strong-password>
coder-studio config --host 0.0.0.0
coder-studio serve --restart
```

Do not expose Coder Studio to the public internet without authentication.

## Not The Focus Of This Launch

The current launch does not focus on:

- hosted cloud workspaces
- team permission systems
- phone-first full coding
- plugin marketplace
- session replay
- cloud preference sync

These may evolve later, but they are not required to understand the first Coder Studio workflow.

## Next Steps

- [Quick Start](Quick-Start.md)
- [First Agent Run](First-Agent-Run.md)
- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Troubleshooting](Troubleshooting.md)
````

- [ ] **Step 5: Tighten English security claims**

In `docs/wiki/Security-and-Privacy.md`, ensure the "What Leaves Your Machine" section includes this sentence:

```markdown
Coder Studio does not operate a hosted code service for your workspace, but any Provider CLI you run may send prompts, code context, terminal output, file snippets, or other task data according to that provider's own behavior and configuration.
```

Ensure the "Network Exposure" section includes this sentence:

```markdown
Treat remote Coder Studio access like remote shell access: anyone who can authenticate may be able to read files, run terminal commands, and trigger provider tools with the permissions of your local user.
```

- [ ] **Step 6: Update indexes for limitations**

Add `known-limitations.md` to `docs/help/README.md` under "我是第一次使用".

Add `Known-Limitations.md` to `docs/wiki/README.md` and `docs/wiki/Home.md` under the start-here lists.

- [ ] **Step 7: Verify mobile and trust docs**

Run:

```bash
rg -n "not.*cloud IDE|VS Code replacement|Node.js 24|Provider CLI|Do not expose|不要把无密码|Mobile is best|移动端适合" docs/help docs/wiki README.md README.zh-CN.md
git diff --check
pnpm ci:lint
```

Expected: boundaries appear in both Chinese and English docs; diff check and lint pass.

- [ ] **Step 8: Commit trust docs**

Run:

```bash
git add docs/help/mobile-guide.md docs/help/known-limitations.md docs/help/README.md docs/wiki/Mobile-and-Remote-Access.md docs/wiki/Security-and-Privacy.md docs/wiki/Known-Limitations.md docs/wiki/README.md docs/wiki/Home.md
git commit -m "docs: clarify launch boundaries and limitations"
```

## Task 5: Contribution Guide And Issue Templates

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/ISSUE_TEMPLATE/installation.yml`
- Create: `.github/ISSUE_TEMPLATE/provider-setup.yml`
- Create: `.github/ISSUE_TEMPLATE/feature-request.yml`
- Create: `.github/ISSUE_TEMPLATE/workflow-showcase.yml`

- [ ] **Step 1: Create `CONTRIBUTING.md`**

Create this file:

````markdown
# Contributing

Thanks for helping improve Coder Studio.

Coder Studio is a self-hosted browser workspace for AI coding agent workflows. The most useful early feedback is concrete: what you tried, what happened, what you expected, and where the first-run path became unclear.

## Good First Feedback

Please open an issue when you hit:

- installation problems
- Provider CLI detection problems
- first agent session confusion
- mobile or remote access setup issues
- documentation that does not match the current UI
- a workflow that feels promising but needs one missing capability

## Before Filing An Issue

Run these commands when relevant:

```bash
node --version
coder-studio version
coder-studio status
coder-studio logs
which claude
which codex
claude --version
codex --version
```

Do not paste secrets, API keys, private source code, or full logs that contain sensitive data.

## Development Setup

```bash
git clone https://github.com/spencerkit/coder-studio.git
cd coder-studio
pnpm install
pnpm dev
```

## Verification

Before handing off code changes, run the relevant command:

```bash
pnpm ci:verify
```

For docs-only changes, at least run:

```bash
git diff --check
pnpm ci:lint
```

## Pull Request Expectations

- Keep changes focused.
- Do not bundle unrelated refactors.
- Include screenshots or short recordings for UI changes.
- Update docs when behavior changes.
- Mention what verification you ran.

## Security

Do not report sensitive security issues in public issues if they include exploitable details. Open a minimal public issue asking for a private contact path, or contact the maintainer through the repository owner profile.
````

- [ ] **Step 2: Create issue template config**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: true
contact_links:
  - name: Quick Start
    url: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/Quick-Start.md
    about: Install and launch Coder Studio.
  - name: First Agent Run
    url: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/First-Agent-Run.md
    about: Run Claude or Codex and review your first diff.
  - name: Security and Privacy
    url: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/Security-and-Privacy.md
    about: Understand local-first behavior and remote access risks.
```

- [ ] **Step 3: Create installation issue template**

Create `.github/ISSUE_TEMPLATE/installation.yml`:

```yaml
name: Installation issue
description: Report problems installing, launching, or opening Coder Studio.
title: "Installation: "
labels: ["installation"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting a first-run issue. Please remove secrets, private paths, API keys, and sensitive logs.
  - type: textarea
    id: steps
    attributes:
      label: What did you try?
      description: Include the exact commands you ran.
      placeholder: |
        npm install -g @spencer-kit/coder-studio
        coder-studio open
    validations:
      required: true
  - type: textarea
    id: result
    attributes:
      label: What happened?
      description: Paste the visible error or describe the behavior.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: What did you expect?
    validations:
      required: true
  - type: input
    id: node
    attributes:
      label: Node.js version
      placeholder: "node --version"
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Coder Studio version
      placeholder: "coder-studio version"
    validations:
      required: true
  - type: input
    id: os
    attributes:
      label: Operating system
      placeholder: "macOS 15, Ubuntu 24.04, Windows 11"
    validations:
      required: true
  - type: textarea
    id: status
    attributes:
      label: Service status and logs
      description: Include `coder-studio status` and relevant `coder-studio logs` output. Remove secrets.
    validations:
      required: false
```

- [ ] **Step 4: Create Provider setup issue template**

Create `.github/ISSUE_TEMPLATE/provider-setup.yml`:

```yaml
name: Provider setup issue
description: Report Claude, Codex, or other Provider CLI detection problems.
title: "Provider setup: "
labels: ["provider"]
body:
  - type: markdown
    attributes:
      value: |
        Use this when Coder Studio cannot find or start a Provider CLI. Remove secrets and private project details.
  - type: dropdown
    id: provider
    attributes:
      label: Provider
      options:
        - Claude Code
        - Codex
        - Gemini CLI
        - Cursor Agent
        - OpenCode
        - Aider-style CLI
    validations:
      required: true
  - type: textarea
    id: commands
    attributes:
      label: Verification commands
      description: Paste relevant output from `which`, `--version`, and Coder Studio logs.
      placeholder: |
        which claude
        claude --version
        coder-studio logs
    validations:
      required: true
  - type: textarea
    id: app
    attributes:
      label: What does Coder Studio show?
      description: Describe the UI state or error message.
    validations:
      required: true
  - type: input
    id: shell
    attributes:
      label: Shell and terminal
      placeholder: "zsh, bash, PowerShell, Windows Terminal"
    validations:
      required: false
  - type: input
    id: os
    attributes:
      label: Operating system
      placeholder: "macOS 15, Ubuntu 24.04, Windows 11"
    validations:
      required: true
```

- [ ] **Step 5: Create feature request issue template**

Create `.github/ISSUE_TEMPLATE/feature-request.yml`:

```yaml
name: Feature request
description: Suggest a product improvement or missing workflow.
title: "Feature: "
labels: ["enhancement"]
body:
  - type: textarea
    id: workflow
    attributes:
      label: Workflow problem
      description: What were you trying to do?
    validations:
      required: true
  - type: textarea
    id: current
    attributes:
      label: Current behavior
      description: What makes the workflow hard today?
    validations:
      required: true
  - type: textarea
    id: desired
    attributes:
      label: Desired behavior
      description: Describe the smallest useful version of the improvement.
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - First run / onboarding
        - Agent sessions
        - Git review
        - Terminal
        - Mobile / remote access
        - Supervisor
        - Work Analysis
        - Skills
        - Provider integrations
        - Other
    validations:
      required: true
```

- [ ] **Step 6: Create workflow showcase issue template**

Create `.github/ISSUE_TEMPLATE/workflow-showcase.yml`:

```yaml
name: Show your workflow
description: Share how you use Coder Studio and what should improve.
title: "Workflow: "
labels: ["workflow"]
body:
  - type: textarea
    id: setup
    attributes:
      label: Your setup
      description: Which agent, OS, device mix, and repository type are you using?
    validations:
      required: true
  - type: textarea
    id: workflow
    attributes:
      label: Workflow
      description: Describe the task from start to finish.
    validations:
      required: true
  - type: textarea
    id: useful
    attributes:
      label: What worked well?
    validations:
      required: false
  - type: textarea
    id: friction
    attributes:
      label: What was confusing or slow?
    validations:
      required: false
```

- [ ] **Step 7: Verify templates**

Run:

```bash
find .github/ISSUE_TEMPLATE -maxdepth 1 -type f -print | sort
rg -n "Installation issue|Provider setup issue|Feature request|Show your workflow" .github/ISSUE_TEMPLATE
git diff --check
pnpm ci:lint
```

Expected: all five template files exist, template names are present, diff check and lint pass.

- [ ] **Step 8: Commit contribution files**

Run:

```bash
git add CONTRIBUTING.md .github/ISSUE_TEMPLATE
git commit -m "docs: add launch feedback templates"
```

## Task 6: Promotion Content Pack

**Files:**
- Create: `docs/promotion/growth-launch-2026-06.zh-CN.md`
- Create: `docs/promotion/growth-launch-2026-06.en.md`
- Create: `docs/promotion/social-posts-2026-06.md`
- Create: `docs/promotion/launch-faq-2026-06.md`
- Modify: `docs/promotion/releases/README.md`

- [ ] **Step 1: Create Chinese launch post**

Create `docs/promotion/growth-launch-2026-06.zh-CN.md`:

````markdown
# Coder Studio 中文增长发布长帖

## 推荐标题

我做了一个自部署的 AI Coding 工作台，用来管理 Claude Code / Codex 长任务

## 正文草稿

很多 AI coding 工作流一开始都很轻：打开终端，启动 Claude Code 或 Codex，写一个 prompt，然后等它输出。

但进入真实项目后，问题会变得分散：

- Agent 在终端里跑，文件在编辑器里看
- 改动需要再切到 Git 工具里审查
- 长任务经常要反复回来确认有没有卡住
- 换到手机或平板后，很难看到完整 workspace 上下文

Coder Studio 想解决的不是“再做一个云 IDE”，而是给 AI coding agent 一个自部署的浏览器工作台。

它把这些东西放在同一个 workspace 里：

- Claude Code / Codex 等 Agent 会话
- 本地终端
- 文件树和 Monaco 编辑器
- Git 状态、changed files 和 diff
- Supervisor 长任务监督
- Work Analysis 工作复盘
- Skills 管理
- 桌面、平板、手机的同一个 workspace 访问

安装方式：

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

第一次试用建议做一个小任务：

1. 打开一个本地仓库。
2. 创建 Claude 或 Codex 会话。
3. 让 Agent 改 README 的一小段说明。
4. 在 Git diff 里审查结果。
5. 用手机或平板打开同一个 workspace 查看进度。

它不是：

- 不是云 IDE
- 不是 VS Code 替代品
- 不是 AI 模型服务
- 不是承诺手机完整替代桌面编码

它更像是围绕本地 repo、本地 shell 和 AI coding CLI 的一层工作台。代码仍然在你的机器上，Provider CLI 是否上传上下文取决于 Claude Code、Codex 等工具自己的行为和配置。

项目地址：

https://github.com/spencerkit/coder-studio

npm：

https://www.npmjs.com/package/@spencer-kit/coder-studio

如果你是 Claude Code / Codex / OpenCode / Gemini CLI 的重度用户，尤其经常跑长任务、审查 diff、或者希望离开电脑后还能看进度，这个项目应该值得试一下。

## V2EX 发布备注

- 标题保持技术导向，不使用夸张词。
- 首帖重点解释“为什么不是云 IDE”。
- 评论区优先收集安装、Provider、Node 版本和 PATH 问题。
- 不在首帖承诺插件系统、团队协作或云同步。
````

- [ ] **Step 2: Create English launch post variants**

Create `docs/promotion/growth-launch-2026-06.en.md`:

````markdown
# Coder Studio English Launch Copy

## Show HN Title

Show HN: Coder Studio - a self-hosted browser workspace for AI coding agents

## Short Description

Coder Studio brings Claude Code, Codex, terminals, files, Git diff review, supervision, and cross-device continuation into one self-hosted browser workspace.

## Long Post Draft

I built Coder Studio because terminal-only AI coding gets scattered once the agent output turns into real project work.

The agent runs in one terminal, files are in an editor, diffs are in another tool, and long tasks require repeatedly checking whether anything stalled. If you leave the machine where the CLI is running, the workflow gets even more awkward.

Coder Studio is a self-hosted browser workspace around local AI coding agent CLIs.

It brings together:

- Claude Code, Codex, Gemini CLI, Cursor Agent, OpenCode, and Aider-style CLI sessions
- local terminals
- file tree and Monaco editor
- Git status, changed files, and diff review
- Supervisor loops for long tasks
- Work Analysis for reviewing what happened over time
- Skills management for reusable agent workflows
- desktop, tablet, and phone access to the same workspace

Install:

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

A good first trial:

1. Open a local repository.
2. Start a Claude or Codex session.
3. Ask the agent for a small README or UI-copy change.
4. Review the changed files and Git diff beside the session.
5. Reopen the same workspace from a phone or tablet to monitor progress.

What it is not:

- not a cloud IDE
- not a VS Code replacement
- not an AI model provider
- not a promise that phone screens replace desktop coding

The code stays on your machine. Provider CLIs may still send prompts, context, and outputs according to their own behavior and configuration.

GitHub:

https://github.com/spencerkit/coder-studio

npm:

https://www.npmjs.com/package/@spencer-kit/coder-studio

I would especially like feedback from people running long Claude Code or Codex tasks, reviewing agent diffs frequently, or switching between desktop and mobile devices during AI coding work.

## Reddit Notes

- For `r/selfhosted`, lead with local-first and remote access boundaries.
- For AI coding communities, lead with Claude Code / Codex workflow pain.
- Avoid posting the same text to many communities on the same day.
- Answer security and Provider CLI questions directly.
````

- [ ] **Step 3: Create social post pack**

Create `docs/promotion/social-posts-2026-06.md`:

````markdown
# Growth Launch Social Posts

## 中文短帖

我做了一个自部署的 AI Coding 工作台 Coder Studio。

它把 Claude Code / Codex、终端、文件、Git diff、Supervisor 长任务监督和移动端查看进度放进同一个浏览器 workspace。

不是云 IDE，也不是 VS Code 替代品。更像是给 AI coding CLI 加一个可审查、可监督、可跨设备继续的工作台。

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

GitHub: https://github.com/spencerkit/coder-studio

## English Short Post

I built Coder Studio, a self-hosted browser workspace for AI coding agents.

It brings Claude Code, Codex, terminals, files, Git diff review, Supervisor loops, and cross-device continuation into one workspace.

Not a cloud IDE, not a VS Code replacement, and not an AI provider. It is a workbench around local repos, local shells, and the agent CLIs you already use.

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

GitHub: https://github.com/spencerkit/coder-studio

## Demo Caption

Start an agent task on desktop, review the changed files and Git diff beside the session, then reopen the same workspace from mobile to check progress.
````

- [ ] **Step 4: Create launch FAQ**

Create `docs/promotion/launch-faq-2026-06.md`:

```markdown
# Growth Launch FAQ

## What is Coder Studio?

Coder Studio is a self-hosted browser workspace for AI coding agent workflows. It brings agent sessions, terminals, files, Git diff review, supervision, work analysis, and cross-device continuation into one workspace.

## Is it a cloud IDE?

No. It runs on your machine and opens local project directories. Remote access is something you configure through LAN, Tailscale, ngrok, Cloudflare Tunnel, or another network path.

## Is it a VS Code replacement?

No. It is focused on AI coding agent workflows: running agents, watching progress, reviewing changes, and continuing across devices.

## Does it include Claude or Codex?

No. You install Provider CLIs separately, such as Claude Code or Codex. Coder Studio detects and launches those local commands.

## Does code leave my machine?

Coder Studio itself is not a hosted code service. Provider CLIs may send prompts, code context, terminal output, file snippets, or other task data according to the provider's own behavior and configuration.

## What is mobile good for?

Mobile is best for checking progress, reading output, browsing files, reviewing diffs, and deciding whether to intervene. Desktop remains the best environment for first setup and heavy editing.

## Why require Node.js 24?

The current package targets the runtime used by the server, CLI, and bundled dependencies. Users should check `node --version` before installing.

## What feedback is most useful?

Installation failures, Provider CLI detection issues, first agent run confusion, mobile setup problems, and real AI coding workflows that still feel awkward.
```

- [ ] **Step 5: Update promotion release index**

In `docs/promotion/releases/README.md`, add a section:

```markdown
## Growth Launch Content Pack

- [Chinese growth launch post](../growth-launch-2026-06.zh-CN.md)
- [English growth launch post](../growth-launch-2026-06.en.md)
- [Social posts](../social-posts-2026-06.md)
- [Launch FAQ](../launch-faq-2026-06.md)
```

- [ ] **Step 6: Verify promotion content**

Run:

```bash
rg -n "self-hosted|自部署|not a cloud IDE|不是云 IDE|Claude Code|Codex|npm install -g @spencer-kit/coder-studio" docs/promotion
git diff --check
pnpm ci:lint
```

Expected: launch positioning appears in Chinese and English content; diff check and lint pass.

- [ ] **Step 7: Commit promotion pack**

Run:

```bash
git add docs/promotion/growth-launch-2026-06.zh-CN.md docs/promotion/growth-launch-2026-06.en.md docs/promotion/social-posts-2026-06.md docs/promotion/launch-faq-2026-06.md docs/promotion/releases/README.md
git commit -m "docs: add growth launch content pack"
```

## Task 7: Launch Verification Checklist And Final Validation

**Files:**
- Create: `docs/promotion/growth-launch-checklist-2026-06.md`

- [ ] **Step 1: Create the launch checklist**

Create `docs/promotion/growth-launch-checklist-2026-06.md`:

````markdown
# Growth Launch Checklist - 2026-06

Use this checklist before posting broadly in English communities.

## Landing Pages

- [ ] `README.md` explains the product in 30 seconds.
- [ ] `README.md` links English users to `docs/wiki/*`.
- [ ] `README.zh-CN.md` links Chinese users to `docs/help/*`.
- [ ] `packages/cli/README.md` explains install, first run, Provider CLIs, and boundaries.
- [ ] `packages/cli/package.json` description and keywords match the launch positioning.

## First Trial

- [ ] Quick Start explains install and `coder-studio open`.
- [ ] First Agent Run explains opening a repo, starting Claude or Codex, and reviewing Git diff.
- [ ] Provider docs explain install, `which`, `--version`, and PATH checks.
- [ ] Troubleshooting covers Node 24, service status, logs, Provider CLI, port, browser, auth, and mobile access.

## Trust And Boundaries

- [ ] Security docs explain local-first behavior and Provider CLI data boundaries.
- [ ] Known Limitations explain Node 24, Provider CLI dependency, mobile limits, and remote access responsibility.
- [ ] Mobile docs describe monitoring and review as the primary phone/tablet use case.
- [ ] README avoids claiming Coder Studio is a cloud IDE, VS Code replacement, AI provider, or full mobile coding replacement.

## Feedback Intake

- [ ] `CONTRIBUTING.md` exists.
- [ ] Installation issue template exists.
- [ ] Provider setup issue template exists.
- [ ] Feature request template exists.
- [ ] Workflow showcase template exists.

## Promotion Materials

- [ ] Chinese long-form post is ready.
- [ ] English launch post is ready.
- [ ] Social posts are ready.
- [ ] Launch FAQ is ready.
- [ ] Show HN title is ready.

## Manual Trial

- [ ] Install from npm in a clean shell.
- [ ] Run `coder-studio open`.
- [ ] Open a local repository.
- [ ] Start one Claude or Codex session.
- [ ] Ask for a small documentation change.
- [ ] Review changed files and Git diff.
- [ ] Open the workspace from a second browser size or device.
- [ ] Record any confusion in the feedback log.

## Verification Commands

```bash
git diff --check
pnpm ci:lint
pnpm ci:test
pnpm ci:build
```

Before public English launch, prefer:

```bash
pnpm ci:verify
```
````

- [ ] **Step 2: Run repository verification**

Run:

```bash
git diff --check
pnpm ci:lint
pnpm ci:test
pnpm ci:build
```

Expected: all commands pass.

- [ ] **Step 3: Run full verification before final handoff**

Run:

```bash
pnpm ci:verify
```

Expected: command passes. If it fails, inspect the failing package or script output, fix the cause, and rerun the failing command before rerunning `pnpm ci:verify`.

- [ ] **Step 4: Commit checklist**

Run:

```bash
git add docs/promotion/growth-launch-checklist-2026-06.md
git commit -m "docs: add growth launch checklist"
```

- [ ] **Step 5: Final status report**

Run:

```bash
git status --short
git log --oneline -n 8
```

Expected:

- only unrelated pre-existing files are untracked or modified
- launch-plan commits are visible
- final response lists changed files, verification commands, and any skipped manual launch steps

## Final Acceptance Criteria

The implementation is complete when:

- English GitHub/npm landing pages use the self-hosted AI coding workspace positioning.
- English users are routed to English wiki docs.
- Chinese users are routed to Chinese help docs.
- First Agent Run exists in Chinese and English.
- Provider and troubleshooting docs cover Node 24, PATH, Provider CLI, service status, logs, and browser/mobile access.
- Mobile docs frame phone/tablet as monitoring and review surfaces.
- Known Limitations exists in Chinese and English.
- Security docs avoid overpromising local-only behavior for Provider CLIs.
- Contribution guide and issue templates exist.
- Chinese and English launch posts, short posts, and FAQ exist.
- Launch checklist exists.
- `pnpm ci:verify` passes or any skipped verification is explicitly reported with the reason.
