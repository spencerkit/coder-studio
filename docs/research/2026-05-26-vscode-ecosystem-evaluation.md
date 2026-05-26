# VS Code Plugin Ecosystem Evaluation

> Status: Research
> Date: 2026-05-26
> Scope: VS Code plugin ecosystem adoption, UI freedom trade-offs, and Theia fit for Coder Studio

## Goal

Record the current product and architecture conclusions for a future decision on whether Coder Studio should move toward the VS Code plugin ecosystem.

This document is a research memo, not an implementation spec.

## Current Product Baseline

Coder Studio currently behaves as a custom browser workspace rather than a VS Code-derived workbench.

Relevant local references:

- Browser workspace positioning: [README.zh-CN.md](../../../README.zh-CN.md)
- Product shell and route model: [docs/PRD.zh-CN.md](../PRD.zh-CN.md)
- Desktop shell: [packages/web/src/shells/desktop-shell.tsx](../../../packages/web/src/shells/desktop-shell.tsx)
- Mobile shell: [packages/web/src/shells/mobile-shell/index.tsx](../../../packages/web/src/shells/mobile-shell/index.tsx)
- Desktop workspace composition: [packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx](../../../packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx)
- Mobile workspace composition: [packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx](../../../packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx)

Current product traits that matter for this evaluation:

- custom desktop shell
- custom mobile shell
- route-driven pages such as welcome, login, workspace, settings, diagnostics
- mobile-first `Dock + Sheet` workspace flow
- agent/session/supervisor/review workflow integrated into a custom app shell

## Core Conclusion

Two goals conflict with each other:

1. maximize VS Code plugin compatibility
2. preserve the current Coder Studio UI freedom

They cannot both be optimized at the same time.

The practical decision boundary is:

- If plugin compatibility is the highest priority, the workbench shell must move closer to VS Code or a VS Code-compatible platform.
- If current UI freedom is the highest priority, Coder Studio can only reuse VS Code-adjacent protocol and editor capabilities, not the full plugin ecosystem.

## What "Highest Plugin Compatibility" Implies

If Coder Studio wants the strongest possible compatibility with the VS Code extension ecosystem, the product shell must largely yield to a VS Code-style workbench model.

Implications:

- main shell follows workbench conventions instead of a custom page shell
- extension lifecycle and contribution points become host-driven
- files/search/scm/terminal/commands/preferences should use workbench-native surfaces
- custom product features should live inside views, widgets, panels, commands, and webviews instead of owning the whole page layout

This direction improves extension compatibility, but reduces control over:

- overall shell layout
- global DOM and CSS ownership
- fully custom page routing as the main experience
- the current independent mobile `Dock + Sheet` interaction model

## What "Keep Current UI Freedom" Implies

If Coder Studio keeps its current UI freedom, it can still adopt selected VS Code-adjacent capabilities:

- Monaco editor services
- LSP-backed language intelligence
- DAP-backed debugger plumbing
- syntax themes, snippets, and editor-level enhancements
- selected VS Code-like services via `monaco-vscode-api`

But it cannot honestly promise:

- broad compatibility with existing VS Code extensions
- full workbench contribution support
- strong compatibility for extensions that need a full extension host, Node runtime, terminal integration, SCM integration, or workbench UI contracts

In short:

- preserve UI freedom -> reuse protocols and editor services
- maximize extension compatibility -> adopt a workbench platform

## Option Comparison

### Option A: OpenVSCode Server / code-server style foundation

Strengths:

- highest extension compatibility
- closest to real VS Code workbench behavior
- least ambiguity about extension host expectations

Costs:

- current Coder Studio shell must largely give way to the workbench shell
- mobile-first interaction model is heavily reduced
- custom product UI becomes embedded features inside the workbench, not the main shell

Best fit when:

- extension compatibility is more important than product shell freedom

### Option B: Theia

Strengths:

- meaningful VS Code extension compatibility
- more shell and layout customization than a strict VS Code workbench route
- supports custom frontend/backend extensions in addition to VS Code-style plugins
- better fit for a hybrid product that still wants a distinct identity

Costs:

- current route-driven shell still needs major refactoring
- desktop can be adapted, but mobile-specific shell patterns should not be assumed to map cleanly
- compatibility is good but not equal to official VS Code

Best fit when:

- the product wants a serious extension ecosystem story without fully surrendering product-level customization

### Option C: Keep current architecture + `monaco-vscode-api`

Strengths:

- highest UI freedom
- lowest shell disruption
- best preservation of the current mobile and cross-device product language

Costs:

- extension compatibility remains limited
- many workbench responsibilities become self-owned platform work
- long-term maintenance cost is high because Coder Studio would be building a partial compatibility layer itself

Best fit when:

- product UI freedom is more important than extension ecosystem breadth

## Recommended Position

Based on the current discussion:

- OpenVSCode-style foundation is the right answer only if extension compatibility clearly outweighs UI freedom.
- Theia is the best compromise if the product wants both some VS Code extension compatibility and some product-level UI control.
- Staying self-built is only the right answer if the team explicitly chooses product shell freedom over extension compatibility.

For the current priority ordering discussed in research:

- `plugin compatibility first`
- `do not fully lose all product customization`

The best-fit direction is **Theia**, with the explicit understanding that this is still a compromise and not full VS Code equivalence.

## Theia-Specific UI Impact

If Coder Studio moves to Theia, the product should not plan on lifting the current UI into Theia unchanged.

### UI areas that must be restructured

- The current page shell model should be replaced by a Theia `ApplicationShell + widgets` model.
- `DesktopShell` and `MobileShell` should no longer be treated as peer top-level app shells.
- `/workspace` should stop being the dominant page abstraction.
- `/settings` should split into standard preferences plus one or more custom product widgets.
- `QuickOpen` and `CommandPalette` should stop competing with workbench-native command surfaces.

### Desktop changes likely required

- `TopBar` should shrink dramatically or disappear as a product-owned global shell.
- custom workspace tabs should likely move to commands, switchers, or a dedicated widget
- files/search/source control should prefer workbench-native views where possible
- status strip should be decomposed into status bar items
- custom panels should be repackaged as Theia widgets, not page regions

### Mobile changes likely required

This is the largest UI loss area.

Current mobile behavior is a dedicated product model:

- top bar
- single active session surface
- bottom dock
- fullscreen sheets for files, terminal, supervisor, and agent session selection

This model should not be assumed to transfer cleanly to Theia.

Research conclusion:

- desktop workbench migration and mobile-shell preservation should be treated as separate concerns
- if mobile is strategically important, keep a separate mobile-optimized frontend rather than forcing Theia to become the mobile shell

This mobile conclusion is an engineering judgment based on Theia's documented workbench and layout model, not a direct vendor promise.

## Practical Mapping of Current UI to Theia

Likely mapping:

- welcome/start flow -> startup widget or launch dialog
- diagnostics -> dedicated widget or command-driven surface
- settings page -> preferences plus custom settings widget
- left activity/sidebar -> Theia view container(s)
- agent/session/supervisor/review -> custom Theia widgets
- bottom terminal panel -> Theia terminal integration or a wrapped custom terminal widget
- footer status strip -> status bar items

Should not be treated as first-class Theia shell concepts:

- current route-driven workspace page
- custom top-level desktop/mobile shell split
- mobile `Dock + Sheet` shell as the primary workbench model

## Decision Triggers For Later

Use this memo to revisit the decision when the team can answer these questions:

1. Is extension compatibility more important than keeping the current mobile-first product shell?
2. Is partial extension compatibility sufficient, or does the team need as much real-world VS Code extension coverage as possible?
3. Is the product willing to split desktop and mobile into different frontend strategies?
4. Does the team want to own a partial compatibility platform over time?

## Research Sources

Official and primary references used in this evaluation:

- VS Code Extension Host: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code Extension Capabilities: https://code.visualstudio.com/api/extension-capabilities/overview
- VS Code Web Extensions: https://code.visualstudio.com/api/extension-guides/web-extensions
- VS Code Language Server Extension Guide: https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
- VS Code Debugger Extension Guide: https://code.visualstudio.com/api/extension-guides/debugger-extension
- Theia Extensions: https://theia-ide.org/docs/extensions/
- Theia Frontend Application Contributions: https://theia-ide.org/docs/frontend_application_contribution/
- Theia Architecture: https://theia-ide.org/docs/architecture/
- `monaco-vscode-api`: https://github.com/CodinGame/monaco-vscode-api

## Final Summary

The current research position is:

- full UI freedom and highest extension compatibility are mutually competing goals
- VS Code-compatible workbench routes favor compatibility over shell freedom
- self-built routes favor shell freedom over compatibility
- Theia is the strongest compromise for Coder Studio if the team wants a serious plugin story without fully collapsing into a pure VS Code shell
- a future Theia path should treat desktop and mobile as different product surfaces rather than assuming one shell serves both equally well
