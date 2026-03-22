# Changelog

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
