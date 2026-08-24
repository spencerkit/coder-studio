# @coder-studio/desktop

## 0.1.4

### Patch Changes

- [#142](https://github.com/spencerkit/coder-studio/pull/142) [`bcb4e20`](https://github.com/spencerkit/coder-studio/commit/bcb4e20643348be6394e03b74c4057cde04de8ce) Thanks [@pallyoung](https://github.com/pallyoung)! - Split Product and Desktop release channels, add signed promotion and compatibility validation for
  independent bundles, and ship the Desktop native notification and update coordination changes.

## 0.1.3

### Patch Changes

- [#138](https://github.com/spencerkit/coder-studio/pull/138) [`262fe0b`](https://github.com/spencerkit/coder-studio/commit/262fe0b4fa073ac010893bac4676f3ed7a88e03c) Thanks [@pallyoung](https://github.com/pallyoung)! - Fix the Desktop runtime rollback trust path so runtime-only updates preserve the bundled Factory Runtime as a trusted rollback candidate.

## 0.1.2

### Patch Changes

- [#115](https://github.com/spencerkit/coder-studio/pull/115) [`e50a6ea`](https://github.com/spencerkit/coder-studio/commit/e50a6ea4ef7bc4447108d840fc82af7e45e9df90) Thanks [@pallyoung](https://github.com/pallyoung)! - Recover authentication after Electron Network Service restarts without bypassing WebSocket reconnect backoff, and auto-hide the native application menu bar.

## 0.1.1

### Patch Changes

- [#90](https://github.com/spencerkit/coder-studio/pull/90) [`ff6bb92`](https://github.com/spencerkit/coder-studio/commit/ff6bb92c0ca30c61f8ee35c4785dcc44f5c3f647) Thanks [@pallyoung](https://github.com/pallyoung)! - Ship the first unified Coder Studio and Desktop Shell release, including the Electron container,
  isolated state locking, the bundled Node Engine, WSL support, and independently signed Product
  Runtime updates with startup validation and automatic rollback.
