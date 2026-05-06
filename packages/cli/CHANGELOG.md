# Changelog

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
