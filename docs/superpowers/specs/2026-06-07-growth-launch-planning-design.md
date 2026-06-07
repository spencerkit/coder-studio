# Growth Launch Planning Design

> Status: Draft
> Date: 2026-06-07
> Scope: promotion planning, README and documentation positioning, launch materials, feedback loop

## Goal

Plan the next 2-3 weeks of Coder Studio work around a growth launch rather than a feature expansion sprint.

The target outcome is:

- make the project easier for new developers to understand within 30 seconds
- make the first successful trial achievable within 5-15 minutes
- create reusable Chinese and English launch materials
- validate positioning in Chinese developer communities before a broader English launch
- use early feedback to decide whether the next product investment should be onboarding, UX polish, or larger features

## Context

Coder Studio already has enough product surface to promote:

- npm package distribution
- GitHub README and Chinese README
- quick start and provider documentation
- wiki and help documentation
- release notes and promotion drafts
- desktop and mobile workspace screenshots
- agent sessions, terminal, files, Git, Supervisor, Work Analysis, and Skills surfaces

Recent development has focused on agent instructions, skills, work analysis, diagnostics, settings, editor, terminal, and workspace UX. The project is not in a blank pre-launch state.

However, broad community promotion would currently risk losing users if the first-visit path does not clearly answer:

- what problem Coder Studio solves
- how it differs from VS Code, SSH, cloud IDEs, and raw Claude Code or Codex CLI usage
- how to install it
- how to run a first agent session
- how to review agent changes
- what mobile usage is good for
- where code and session data live

## Decision

Run a 2-3 week growth launch sprint with this sequence:

1. prepare the launch conversion path
2. validate in Chinese developer communities
3. revise from feedback
4. launch to English/global developer communities

This means the next planning priority is:

1. documentation and onboarding path
2. demo and promotion assets
3. small Chinese-community validation
4. lightweight UX fixes for first-run blockers
5. English public launch
6. feature expansion only after real feedback

## Non-Goals

This launch sprint does not prioritize large product expansion.

Out of scope for this phase:

- plugin system
- deep multi-workspace management
- session replay
- workspace preference sync
- broad UI redesign
- large provider expansion
- team collaboration and permission systems
- cloud sync or hosted account infrastructure

These may become important later, but they should not delay the first serious promotion cycle.

## Positioning

### Primary English Positioning

Coder Studio is a self-hosted browser workspace for running, reviewing, supervising, and continuing AI coding agent work across devices.

Longer form:

Coder Studio brings Claude Code, Codex, terminals, files, Git diff review, supervision, and cross-device continuation into one self-hosted browser workspace.

### Primary Chinese Positioning

Coder Studio 是一个自部署的 AI Coding 工作台，把 Claude Code / Codex、终端、文件、Git diff、任务监督和移动端查看进度放进同一个浏览器 workspace。

### Positioning Boundaries

The launch copy should avoid claiming that Coder Studio is:

- a VS Code replacement
- a cloud IDE
- an AI agent itself
- a full mobile coding replacement for desktop development
- a fully autonomous task-completion system

The product should be framed as an agent workflow workbench:

- run agent sessions
- keep terminal, files, and Git together
- review AI changes
- monitor long tasks
- continue from desktop, tablet, or phone
- keep code local or self-hosted

## Success Criteria

The launch should be evaluated as a funnel, not only by GitHub stars.

### Exposure

- GitHub stars grow after promotion windows
- npm weekly downloads increase
- community posts receive relevant comments, saves, or reposts
- external links begin to send traffic to the repository

### Activation

Because the project may not have telemetry, early activation can be measured through issues, comments, and direct user feedback.

Key activation signals:

- users can install the package
- users can open the first workspace
- users can create a Claude or Codex session
- users understand how to inspect Git diff after agent work
- users understand the intended mobile use case
- users can resolve common Node, Provider CLI, PATH, port, or auth issues using docs

### Learning

Each feedback item should be classified as one of:

- positioning misunderstanding
- installation failure
- provider setup issue
- product experience confusion
- feature request

The first three categories should usually be handled before large feature work.

## Required Launch Materials

### README First Screen

The README first screen should behave as the main conversion surface for GitHub traffic.

It should include:

- a clear one-line positioning statement
- three primary use cases:
  - long-running agent supervision
  - cross-device continuation
  - reviewable AI changes
- a primary GIF, short video, or screenshot that shows agent session, editor, Git diff, and mobile continuation
- a compact 5-minute quick start
- clear boundaries versus raw terminal workflows, VS Code, SSH, and cloud IDEs

The English and Chinese READMEs should keep the same information architecture even when wording differs.

### Five-Minute Demo

Create one canonical demo scenario used across README, posts, and release material.

The demo should show:

1. install Coder Studio
2. launch with `coder-studio open`
3. open a real repository
4. start a Claude or Codex session
5. ask the agent to make a small concrete change
6. review the result in Git diff
7. show mobile or narrow-screen continuation for progress review

Recommended outputs:

- 30-60 second GIF or video
- text walkthrough
- short caption for social posts

### First-Run Documentation

The existing documentation should be augmented with first-run focused pages or sections:

- First Agent Run
- Remote / Mobile Setup
- First Run Troubleshooting

These docs should explicitly cover:

- Node.js 24 requirement
- Provider CLI installation
- provider command detection
- PATH issues
- port conflicts
- browser open failures
- local network access
- Tailscale, ngrok, or Cloudflare Tunnel style access
- auth and remote exposure risks

### Promotion Content Pack

Prepare reusable content before posting.

Required drafts:

- Chinese long-form launch post
- Chinese short post for social feeds
- English launch post
- Hacker News Show HN version
- Reddit-oriented version
- release narrative
- FAQ

The drafts should be adapted per channel rather than copied verbatim everywhere.

### Trust Materials

Add or refine trust-building documentation:

- Security and Privacy
- Known Limitations
- Roadmap
- Contributing and issue templates

The Roadmap should distinguish committed near-term work from exploratory ideas.

Known Limitations should proactively mention:

- Node 24 requirement
- local Provider CLI dependency
- mobile is strongest for monitoring and review, not heavy editing
- remote access requires network and security setup by the user

## Execution Schedule

### Week 1: Launch Conversion Preparation

Goal: make the project ready to receive unfamiliar users.

Deliverables:

- README first-screen refresh
- Quick Start flow tightening
- First Agent Run guide
- Remote / Mobile Setup guide
- First Run Troubleshooting guide
- 30-60 second demo GIF or video
- Chinese and English launch drafts
- Security, limitations, and roadmap updates
- npm package page and GitHub topics consistency check

Validation:

- run 3-5 small test trials with known developers or small groups
- record where they misunderstand the product
- record where installation or provider setup fails

### Week 2: Chinese Community Validation

Goal: validate positioning and onboarding before global promotion.

Recommended channels:

- V2EX for a developer-focused long post
- Juejin or Zhihu for a searchable article
- Jike or Chinese X for short demo-driven posts
- small WeChat groups or direct contacts for practical first-run feedback

Daily loop:

1. collect comments, issues, and direct feedback
2. classify feedback into the five categories
3. update README, docs, FAQ, or small UX affordances
4. avoid committing to large features during this week

The main question for this week is not "did it go viral?".

The main question is:

Can a motivated AI coding user understand and try Coder Studio without direct help?

### Week 3: English Launch

Goal: broaden reach after the first conversion path has been validated.

Recommended channel order:

1. make GitHub README and latest release narrative final
2. post to one or two best-fit Reddit communities first
3. publish a Hacker News Show HN post
4. share demo-driven posts on X or Bluesky
5. consider Product Hunt only after demo, website or landing surface, and comment support are ready

Recommended Show HN title:

`Show HN: Coder Studio - a self-hosted browser workspace for AI coding agents`

English launch posts should emphasize:

- self-hosted
- local code control
- AI coding agent workflow
- reviewable changes
- cross-device continuation
- supervisor loops for long tasks

## Product Polish Priorities

### P0: First-Run Blockers

Fix or document anything that prevents a new user from reaching the first successful agent session:

- Node version failures
- missing Provider CLI
- provider command not found because of PATH
- port conflicts
- service startup failures
- browser launch failures
- unclear workspace opening flow
- unclear provider installation prompt

### P1: Conversion Improvements

These improve trial quality but are not hard blockers:

- demo walkthrough task
- mobile first-use framing
- GitHub issue and discussion templates
- release narrative that explains why the current version is worth trying
- FAQ answers for common comparisons

### P2: Deferred Product Expansion

Do not start these until launch feedback says they are more important than onboarding:

- plugin system
- session replay
- deep multi-workspace management
- large UI redesign
- new provider expansion
- team collaboration
- hosted service or account system

## FAQ Themes

The launch FAQ should answer:

- What is the relationship with Claude Code and Codex?
- Why not just use a terminal?
- Why not just use VS Code Remote or SSH?
- Is code uploaded anywhere?
- What is mobile usage good for?
- Can it be used without Claude or Codex installed?
- Is Node 24 required?
- Is this suitable for teams?
- How should remote access be secured?

## Feedback Handling Policy

Feedback should be handled in this order:

1. if users misunderstand positioning, update README and launch copy
2. if users fail installation, update Quick Start, troubleshooting, or startup diagnostics
3. if users fail provider setup, update provider docs and UI hints
4. if users are confused in-product, consider small UX changes
5. if users request large features, record them but defer until repeated demand appears

This policy keeps the sprint focused on conversion and learning.

## Risks

### Risk: Launch copy sounds too broad

Mitigation:

- keep the product framed around AI coding agent workflows
- explicitly say it is not a VS Code replacement or cloud IDE

### Risk: Users install but cannot start an agent session

Mitigation:

- prioritize First Agent Run and Provider setup docs
- make Provider CLI missing states point to concrete commands

### Risk: Mobile promise is misunderstood

Mitigation:

- describe mobile as monitoring, progress checking, session viewing, and code review
- avoid promising full heavy coding on phone

### Risk: Feature requests pull the sprint off course

Mitigation:

- classify requests and defer large work until repeated evidence appears

### Risk: English launch happens before onboarding is ready

Mitigation:

- gate English launch on Chinese validation feedback and documentation fixes

## Verification

Before starting broad English promotion, verify:

1. a new user can follow README quick start without extra explanation
2. First Agent Run explains both successful and missing-provider paths
3. Remote / Mobile Setup explains local network and secure tunnel options
4. First Run Troubleshooting covers Node, Provider CLI, PATH, port, auth, and browser issues
5. demo asset matches the current UI
6. Chinese and English launch posts use the same product claims
7. Security and Privacy language does not overpromise
8. Known Limitations are visible enough to prevent avoidable disappointment
9. issue templates exist for installation, provider setup, and feature requests

## Fixed Planning Choices

To keep the implementation plan concrete, use these defaults unless new evidence changes them:

- canonical demo: use Coder Studio itself or another real open source repository with visible README, source, and tests; the task should be a small documentation or UI-copy change that produces an easy-to-review Git diff
- first public Chinese channel: V2EX, because it best matches developer discussion and early technical feedback
- English launch surface: GitHub README is sufficient for this phase; do not wait for a standalone website before the first English launch
