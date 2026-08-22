# Changelog

## 0.5.12

### Patch Changes

- [#140](https://github.com/spencerkit/coder-studio/pull/140) [`5049484`](https://github.com/spencerkit/coder-studio/commit/504948431189c085150a7ab3a89edeb88403f6de) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix packaged Desktop startup by allowing Vite to bundle and rewrite deferred application routes instead of leaving unresolved browser-native module paths.

## 0.5.11

### Patch Changes

- [#131](https://github.com/spencerkit/coder-studio/pull/131) [`a51681a`](https://github.com/spencerkit/coder-studio/commit/a51681a503aea4b61160850bd5388a0f0ab945a7) Thanks [@pallyoung](https://github.com/pallyoung)! - Reduce runtime startup blocking work by deferring more shell and bootstrap setup off the initial
  path, and revalidate the server-backed workspace last viewed target before committing inactive
  bootstrap prefetch state after activation resumes. This preserves the faster workspace list
  prefetch path while avoiding stale workspace restoration when another tab changed the target during
  inactivity.

## 0.5.10

### Patch Changes

- [#123](https://github.com/spencerkit/coder-studio/pull/123) [`a72abb7`](https://github.com/spencerkit/coder-studio/commit/a72abb789d04888820979ab008175d23a2580277) Thanks [@pallyoung](https://github.com/pallyoung)! - Ship the dual-channel Desktop migration: keep Shell 0.1.1 on Runtime-only updates, show the one-time Shell 0.1.2 migration guidance, and validate legacy and modern release artifacts independently.

## 0.5.9

### Patch Changes

- [#115](https://github.com/spencerkit/coder-studio/pull/115) [`e50a6ea`](https://github.com/spencerkit/coder-studio/commit/e50a6ea4ef7bc4447108d840fc82af7e45e9df90) Thanks [@pallyoung](https://github.com/pallyoung)! - Improve product update version and diagnostics UI, and let Desktop web clients request authentication recovery while reconnecting.

## 0.5.8

### Patch Changes

- [#105](https://github.com/spencerkit/coder-studio/pull/105) [`7c15fdf`](https://github.com/spencerkit/coder-studio/commit/7c15fdf6d883fbb2b424952e17e28f852c93692e) Thanks [@pallyoung](https://github.com/pallyoung)! - Validate the final packed CLI manifest and every declared package entry before publishing, emit the public type declaration referenced by the package exports, and isolate npm acceptance candidates under traceable `rc-<run-id>-<attempt>` dist-tags.

## 0.5.7

### Patch Changes

- [#90](https://github.com/spencerkit/coder-studio/pull/90) [`ff6bb92`](https://github.com/spencerkit/coder-studio/commit/ff6bb92c0ca30c61f8ee35c4785dcc44f5c3f647) Thanks [@pallyoung](https://github.com/pallyoung)! - Ship the first unified Coder Studio and Desktop Shell release, including the Electron container,
  isolated state locking, the bundled Node Engine, WSL support, and independently signed Product
  Runtime updates with startup validation and automatic rollback.

## 0.5.6

### Patch Changes

- [#87](https://github.com/spencerkit/coder-studio/pull/87) [`aca2fc6`](https://github.com/spencerkit/coder-studio/commit/aca2fc6e99b4a70d980151a5560a8ab74313a499) Thanks [@pallyoung](https://github.com/pallyoung)! - Ship the post-0.5.5 canvas and workspace runtime updates, including canvas rendering, embedded routes, PNG export support, terminal/runtime wiring, and release verification fixes.

## 0.5.5

### Patch Changes

- [#82](https://github.com/spencerkit/coder-studio/pull/82) [`54ddf11`](https://github.com/spencerkit/coder-studio/commit/54ddf1157c2c7b86b1996d68fcbe2a40a9ccb958) Thanks [@pallyoung](https://github.com/pallyoung)! - Refresh workspace and runtime flows with canvas support, terminal profile improvements, skill management updates, and follow-up Windows and UI fixes.

## 0.5.4

### Patch Changes

- [#82](https://github.com/spencerkit/coder-studio/pull/82) [`4ebd361`](https://github.com/spencerkit/coder-studio/commit/4ebd361432c844f501d0bdc01bda8e86803b6265) Thanks [@pallyoung](https://github.com/pallyoung)! - Stabilize the web test suite and fix workspace UI and dev-browser regressions.

## 0.5.3

### Patch Changes

- [#80](https://github.com/spencerkit/coder-studio/pull/80) [`c62bdc4`](https://github.com/spencerkit/coder-studio/commit/c62bdc450b83caf094ef68ef5486286541f47b9f) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix server startup failure when bundled web assets include `dev-browser-sw.js` by excluding the service worker from static file glob registration.

## 0.5.2

### Patch Changes

- [#77](https://github.com/spencerkit/coder-studio/pull/77) [`15c664c`](https://github.com/spencerkit/coder-studio/commit/15c664cfc8c3d48c1f585f1abf6c82bc2aa09290) Thanks [@pallyoung](https://github.com/pallyoung)! - Stabilize the web test suite and fix workspace UI and dev-browser regressions.

## 0.5.1

### Patch Changes

- [#75](https://github.com/spencerkit/coder-studio/pull/75) [`a5e71c7`](https://github.com/spencerkit/coder-studio/commit/a5e71c71ce072cd61dfde534ecbeb6ef5c3d631d) Thanks [@pallyoung](https://github.com/pallyoung)! - Hide the unfinished extension status entry from the workspace activity bar.

## 0.5.0

### Minor Changes

- [#72](https://github.com/spencerkit/coder-studio/pull/72) [`93e05d6`](https://github.com/spencerkit/coder-studio/commit/93e05d690135f6ef939fa33a465380b00fd99de9) Thanks [@pallyoung](https://github.com/pallyoung)! - Add expanded provider runtime support, agent instruction generation, skills management, and work analysis dashboard updates.

## 0.4.9

### Patch Changes

- [#69](https://github.com/spencerkit/coder-studio/pull/69) [`a4df948`](https://github.com/spencerkit/coder-studio/commit/a4df9486d7dd560e0d489b565d530f215fae2d4c) Thanks [@pallyoung](https://github.com/pallyoung)! - Improve workspace, diagnostics, monitoring, and editor workflows with system
  dependency installs, managed Vue LSP support, file history previews, and
  refined settings and workspace surfaces.

## 0.4.8

### Patch Changes

- [#67](https://github.com/spencerkit/coder-studio/pull/67) [`070a729`](https://github.com/spencerkit/coder-studio/commit/070a729c37ca6438eb264bbeae0ee613e51ea753) Thanks [@pallyoung](https://github.com/pallyoung)! - Refine workspace theming and session ergonomics by adding pane drag reordering,
  stabilizing update checks, hardening PTY color environment isolation, and
  polishing shared desktop surfaces across the app.

## 0.4.7

### Patch Changes

- [#64](https://github.com/spencerkit/coder-studio/pull/64) [`d14fe08`](https://github.com/spencerkit/coder-studio/commit/d14fe08d7861652a9290559d5a59aa766c286309) Thanks [@pallyoung](https://github.com/pallyoung)! - Refine workspace theming and session ergonomics by adding pane drag reordering,
  stabilizing update checks, hardening PTY color environment isolation, and
  polishing shared desktop surfaces across the app.

## 0.4.6

### Patch Changes

- [#62](https://github.com/spencerkit/coder-studio/pull/62) [`535c3c0`](https://github.com/spencerkit/coder-studio/commit/535c3c09cc5895e3b3b949067633f8a6bb3644f8) Thanks [@pallyoung](https://github.com/pallyoung)! - Improve desktop workspace ergonomics by adding keyboard pane navigation,
  supporting workspace path drops into terminal sessions, and launching themed
  PTYs with terminal-aware background environment hints.

## 0.4.5

### Patch Changes

- [#60](https://github.com/spencerkit/coder-studio/pull/60) [`b271591`](https://github.com/spencerkit/coder-studio/commit/b271591eb48f90d33883049e44db639a4afc2b51) Thanks [@pallyoung](https://github.com/pallyoung)! - Polish workspace background material rendering so personalized glass and background image settings apply more consistently across the main workspace surfaces.

## 0.4.4

### Patch Changes

- [#58](https://github.com/spencerkit/coder-studio/pull/58) [`5641146`](https://github.com/spencerkit/coder-studio/commit/5641146c06fe6ecfe0f5d19d738b94298b1b5c57) Thanks [@pallyoung](https://github.com/pallyoung)! - Refine workspace navigation and editor management across desktop and mobile by
  polishing sidebar section actions, improving quick jump and search flows, and
  tightening preview and recovery behavior around open editors.

## 0.4.3

### Patch Changes

- [#56](https://github.com/spencerkit/coder-studio/pull/56) [`5b93d9d`](https://github.com/spencerkit/coder-studio/commit/5b93d9d994c6d33f738fa0657c3d37e7cd93a157) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix terminal recovery so session output no longer stalls after noop reconcile
  decisions or gets cleared when queued live chunks flush after snapshot
  hydration.

## 0.4.2

### Patch Changes

- [#54](https://github.com/spencerkit/coder-studio/pull/54) [`911fc5f`](https://github.com/spencerkit/coder-studio/commit/911fc5f706c186db7809564937550e009c44b190) Thanks [@pallyoung](https://github.com/pallyoung)! - Refine diagnostics and review workflows by surfacing installed Git and Node.js
  versions, keeping mobile and desktop commit diff previews consistent, and
  hardening Windows path safety plus server CI builds.

## 0.4.1

### Patch Changes

- [#52](https://github.com/spencerkit/coder-studio/pull/52) [`7a9ae25`](https://github.com/spencerkit/coder-studio/commit/7a9ae25841511d8056231add1d37a8e2bae7ca1d) Thanks [@pallyoung](https://github.com/pallyoung)! - Release the CI pipeline repair by removing unused server symbols that broke the
  Windows package build and by adding the standalone server build to `ci:build`.

## 0.4.0

### Minor Changes

- [#48](https://github.com/spencerkit/coder-studio/pull/48) [`ca5767f`](https://github.com/spencerkit/coder-studio/commit/ca5767f6f87e409ce513e4e1933730217fc50810) Thanks [@pallyoung](https://github.com/pallyoung)! - Add configurable LSP runtime behavior with managed language server installation, and improve supervisor restore and editing flows across desktop and mobile.

## 0.3.11

### Patch Changes

- [#46](https://github.com/spencerkit/coder-studio/pull/46) [`382479f`](https://github.com/spencerkit/coder-studio/commit/382479ffa377eb83f7a7afe6e6a7400822e72af9) Thanks [@pallyoung](https://github.com/pallyoung)! - Minor bug fixes and polish.

## 0.3.10

### Patch Changes

- [#43](https://github.com/spencerkit/coder-studio/pull/43) [`ee20f64`](https://github.com/spencerkit/coder-studio/commit/ee20f641888663152f1a5ce5774e5e2b5a52e7b3) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix supervisor dialog polish by removing the duplicated desktop intro panel and ensuring the scheduled-time picker popover renders above modal overlays.

## 0.3.9

### Patch Changes

- [#41](https://github.com/spencerkit/coder-studio/pull/41) [`37f68b2`](https://github.com/spencerkit/coder-studio/commit/37f68b22fa605d1cbe92a6b8bc7e2ad550bfad89) Thanks [@pallyoung](https://github.com/pallyoung)! - Polish desktop and mobile workspace chrome, settings surfaces, terminal fullscreen layout, and supervisor evaluation guidance.

## 0.3.8

### Patch Changes

- [#37](https://github.com/spencerkit/coder-studio/pull/37) [`e27cd04`](https://github.com/spencerkit/coder-studio/commit/e27cd048832ff72d337512329695d6914ad38f37) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix Windows runtime verification by preserving supervisor plan step status literals during evaluation payload parsing so the bundled server package builds cleanly in CI.

- [#37](https://github.com/spencerkit/coder-studio/pull/37) [`2ed1034`](https://github.com/spencerkit/coder-studio/commit/2ed10341e1af65290545731525f7fe7e6435dac7) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix supervisor creation rollback when target files fail, and keep manual trigger disabled while an earlier supervisor cycle is still in flight.

## 0.3.7

### Why this patch matters

`v0.3.7` is a UI and workflow polish release focused on consistency. It makes icon styling truly theme-owned across the workspace, fixes places where icons in the same surface could drift into mismatched colors, improves mobile terminal paste and upload flows, and makes workspace target restore more dependable when you return to an existing workspace.

In practice, this release means:

- file tree, mobile workspace dock, settings navigation, and Git footer icons now follow the active theme more consistently
- Git footer status actions stay visually distinguishable instead of collapsing into one generic symbol set
- mobile terminal paste is easier to trigger, with clearer fallback handling and mobile upload actions in the same flow
- reopening a workspace restores the last viewed target more reliably, including safer handling around rapid target switching

### Included in v0.3.7

- add theme-owned semantic icon styling for shared workspace and settings surfaces
- scope icon palettes by UI context so different areas can stay cohesive without losing meaning
- align icon groups across supported themes for the file tree, mobile dock, settings navigation, and Git footer
- improve mobile terminal paste and upload UX for touch-first usage
- harden last-viewed workspace target persistence and restore behavior
- fix Git footer icon differentiation for change counts, remote state, local push state, and refresh actions

## 0.3.6

### Patch Changes

- [#33](https://github.com/spencerkit/coder-studio/pull/33) [`851bf21`](https://github.com/spencerkit/coder-studio/commit/851bf213567b638774a4c0bfd0197f07d0f16eeb) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix the shared settings switch thumb alignment so the knob stays vertically centered and reaches the correct checked position.

## 0.3.5

### Patch Changes

- [#31](https://github.com/spencerkit/coder-studio/pull/31) [`3139ef4`](https://github.com/spencerkit/coder-studio/commit/3139ef444400ed9064a0304b520c1c5aa475ebdb) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix terminal websocket recovery so buffered PTY output is replayed after silent disconnects, including probe-based recovery and keepalive handling.

## 0.3.4

### Patch Changes

- [#29](https://github.com/spencerkit/coder-studio/pull/29) [`257f258`](https://github.com/spencerkit/coder-studio/commit/257f258899c3595497e5a1ae72e7047ed1aced74) Thanks [@pallyoung](https://github.com/pallyoung)! - Refresh the published workspace screenshots in the README and help guides so they match the current desktop and mobile editor shell UI.

## 0.3.3

### Patch Changes

- [#27](https://github.com/spencerkit/coder-studio/pull/27) [`4521ccd`](https://github.com/spencerkit/coder-studio/commit/4521ccd288d9dcbf77e486e118b6c09721a65eab) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix the mobile workspace Git tab tests so CI no longer fails on stale legacy class assertions after the shared tab styling migration.

## 0.3.2

### Patch Changes

- [#24](https://github.com/spencerkit/coder-studio/pull/24) [`23ca9a6`](https://github.com/spencerkit/coder-studio/commit/23ca9a6ca8b6060106ff370b248efb9ff464e3cb) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix the bundled web favicon assets by regenerating the PNG and ICO files directly from the SVG source so the icon keeps transparent edges without the visible border artifact.

## 0.3.1

### Patch Changes

- [#21](https://github.com/spencerkit/coder-studio/pull/21) [`ce9607d`](https://github.com/spencerkit/coder-studio/commit/ce9607daba95019a4a5cdf2a2df8b78fbbf38b53) Thanks [@pallyoung](https://github.com/pallyoung)! - Refactor the CLI entry structure so the executable wrapper only launches the command entrypoint, while the reusable CLI logic lives in a separate module. This fixes cases where globally installed `coder-studio` commands could fail to print output because the entry module was misdetected.

## 0.3.0

### Minor Changes

- [#19](https://github.com/spencerkit/coder-studio/pull/19) [`31af2cc`](https://github.com/spencerkit/coder-studio/commit/31af2cc58cdd6a6587d335c18baf6b5d52cd3df6) Thanks [@pallyoung](https://github.com/pallyoung)! - Align the published CLI package manifest with the development entrypoints while keeping dist-based publish overrides.

All notable changes to this project will be documented in this file.

## 0.2.1

### Changed

- Remote public-mode access no longer hard-requires HTTPS. HTTP access is now allowed, while HTTPS remains recommended for public deployment.
- The auth gate now shows the normal sign-in flow on remote HTTP hosts instead of blocking with an HTTPS requirement.
- Deployment docs now document the HTTP/HTTPS tradeoff and the `Secure` cookie behavior more clearly.

### Added

- Release E2E coverage for remote HTTP sign-in.
- Community support acknowledgement for LinuxDo in the Chinese homepage README.

## 0.2.0

### Added

- Initial local-server + web-ui workbench release for local folders and remote Git repositories.
- Claude-based workspace flow with draft tasks, split panes, and PTY-style agent interaction.
- Code browsing and editing with file tree, file search, Monaco preview/edit, and save.
- Git workflow support with diff review, stage, unstage, discard, and commit actions.
- Embedded multi-terminal workspace panel.
- Public-mode auth with passphrase login, session cookies, root-path restrictions, and IP blocking.
- npm CLI packaging, release verification, and cross-platform runtime publishing flow.
