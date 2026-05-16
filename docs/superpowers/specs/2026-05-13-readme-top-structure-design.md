# README Top Structure Design

> Status: Draft
> Date: 2026-05-13
> Scope: `README.md`, `README.zh-CN.md`

## Goal

Restructure the top section of the GitHub README so new visitors understand Coder Studio faster and are more likely to watch the demo, try the project, and then star the repository.

This design prioritizes two audiences:

- AI coding power users
- Developers who switch between desktop, tablet, and phone

## Problem

The current README top section behaves like a conventional repository overview:

- badges first
- broad product description
- feature list
- screenshot
- demo link

That structure is readable, but it does not emphasize the product's strongest differentiators early enough:

- browser-based AI coding workflow
- cross-device continuity
- Claude Code and Codex in one workspace

For this project, conversion depends more on product comprehension than on repository metadata.

## Decision

Use a hybrid README structure:

- the first screen behaves like a lightweight product landing section
- the rest of the README keeps standard open source repository sections

This avoids two failure modes:

- too repository-like: clear but low-conviction
- too marketing-like: visually punchy but weak as a GitHub project document

## Proposed Top Structure

The redesigned top section should use this order:

1. Logo and project name
2. Sharper one-line positioning
3. Short supporting paragraph
4. Core badges only
5. Primary action links:
   - `Watch Demo`
   - `Quick Start`
   - `Star on GitHub`
6. Language and docs links
7. Demo poster linked to recorded `mp4`
8. One-line explanation of what the demo proves
9. `Why It Feels Different` section with three differentiation bullets
10. `Quick Start`

## Content Changes

### Keep

- logo
- project name
- English/Chinese cross-link
- demo poster and `mp4`
- existing quick start command
- lower README sections after quick start

### Modify

- one-line positioning statement
- supporting paragraph under the title
- badge selection and visual prominence
- demo framing copy
- top information order

### Add

- explicit CTA row
- `Why It Feels Different` section
- demo proof sentence

### Remove Or Move Down

- top blockquote
- top static workspace screenshot
- top six-item feature list
- secondary badges from the first visual block

The screenshot and longer feature listing are still useful, but they should appear after the user understands the product shape and sees the demo entry.

## Badge Policy

Keep these badges in the first screen:

- npm version
- license
- Node.js version
- GitHub stars

Move these out of the first visual block:

- discussions
- open issues
- contributors

Reason: they are useful trust signals, but they compete with the demo and action links without helping first-time comprehension.

## Copy Direction

The new top copy should be concrete and workflow-oriented.

It should directly communicate:

- browser-based workspace
- AI coding workflow
- device switching
- Claude Code and Codex support

It should avoid:

- abstract slogans as primary messaging
- long lists before the demo
- generic feature language that could apply to any browser IDE

## English And Chinese Parity

`README.md` and `README.zh-CN.md` should keep the same information architecture.

The Chinese version does not need to be word-for-word identical, but it should preserve:

- same CTA order
- same structural blocks
- same product claims

## Non-Goals

This change does not redesign the entire README.

It does not include:

- new screenshots
- new feature sections below quick start
- roadmap rewrite
- documentation restructuring
- badge removal from the repository entirely

## Risks

### Risk: too much marketing tone

Mitigation:

- keep direct technical language
- keep quick start near the top
- keep lower repository sections intact

### Risk: star CTA feels premature

Mitigation:

- make `Watch Demo` the primary first action
- make `Star on GitHub` a secondary action after product context exists

### Risk: top becomes visually crowded

Mitigation:

- reduce badge count
- reduce feature count from six to three
- remove duplicate top-of-page media

## Verification

After implementation, verify:

1. the top section reads cleanly on GitHub markdown rendering
2. both README files keep the same structure
3. demo poster links to the correct `mp4`
4. `Quick Start` anchor works from the CTA row
5. no broken markdown formatting is introduced

## Implementation Boundary

Only edit:

- `README.md`
- `README.zh-CN.md`

No asset changes are required for this phase.
