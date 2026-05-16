# README Top Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the top of both README files for faster product comprehension on GitHub and add a README-friendly animated demo preview.

**Architecture:** Keep the existing repository sections after quick start, but replace the top section with a tighter landing-style structure. Use a lightweight animated GIF as the inline preview in README and keep the existing `mp4` as the full demo target.

**Tech Stack:** Markdown, ffmpeg, existing demo assets in `docs/assets`

---

### Task 1: Create README-Friendly Demo Preview Asset

**Files:**
- Create: `docs/assets/demo-preview.gif`
- Modify: `docs/assets/demo.mp4` (no changes expected)
- Modify: `docs/assets/demo-poster.png` (no changes expected)

- [ ] **Step 1: Generate a compact animated GIF from the recorded MP4**

Run:

```bash
ffmpeg -y -i docs/assets/demo.mp4 -vf "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 docs/assets/demo-preview.gif
```

Expected: `docs/assets/demo-preview.gif` is created successfully.

- [ ] **Step 2: Verify the GIF asset exists and is a reasonable size**

Run:

```bash
ls -lh docs/assets/demo-preview.gif docs/assets/demo.mp4 docs/assets/demo-poster.png
```

Expected: the GIF exists and remains small enough for repository use.

- [ ] **Step 3: Keep the MP4 as the full demo target**

No file edit required. The README will use the GIF as inline preview and link through to `docs/assets/demo.mp4`.

### Task 2: Refactor README.md Top Section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the current top block with the approved landing-style structure**

Edit the top portion of `README.md` so it contains:

- logo and title
- sharper one-line positioning statement
- supporting paragraph
- reduced badge set
- CTA row with `Watch Demo`, `Quick Start`, `Star on GitHub`
- language/docs links
- inline GIF preview linked to `docs/assets/demo.mp4`
- one-line demo framing copy
- `Why It Feels Different`
- quick start moved up

- [ ] **Step 2: Remove or move down top-of-page content that competes with the demo**

Specifically remove from the top block:

- blockquote slogan
- top six-item feature list
- top static workspace overview screenshot
- discussions / issues / contributors badges from the first visual block

- [ ] **Step 3: Keep lower repository sections unchanged unless needed for heading continuity**

Preserve existing sections below quick start, including use cases, screenshots, feature overview, docs, roadmap, contributing, and license.

### Task 3: Refactor README.zh-CN.md Top Section

**Files:**
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Mirror the English information architecture in Chinese**

Edit the top portion of `README.zh-CN.md` so it matches the same structure and CTA order as `README.md`.

- [ ] **Step 2: Use Chinese copy that preserves the same product claims**

The Chinese version should clearly communicate:

- browser-based AI coding workspace
- cross-device continuity
- Claude Code and Codex in one workspace
- demo first, star second

- [ ] **Step 3: Keep lower sections intact**

Do not redesign the rest of the Chinese README in this pass.

### Task 4: Verify README Rendering Inputs

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create: `docs/assets/demo-preview.gif`

- [ ] **Step 1: Verify README media references**

Run:

```bash
rg -n "demo-preview\\.gif|demo\\.mp4|demo-poster\\.png|Quick Start|快速开始" README.md README.zh-CN.md
```

Expected: both README files reference the new GIF preview and the MP4 target consistently.

- [ ] **Step 2: Inspect the diff for only intended files**

Run:

```bash
git diff -- README.md README.zh-CN.md docs/assets/demo-preview.gif
```

Expected: only the approved top-structure and preview changes appear.

- [ ] **Step 3: Verify repository status remains scoped**

Run:

```bash
git status --short
```

Expected: only intended README/media/spec/plan changes are new in this task; unrelated untracked files remain untouched.
