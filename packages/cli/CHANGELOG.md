# Changelog

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
