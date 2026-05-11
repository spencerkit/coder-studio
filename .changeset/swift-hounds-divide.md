---
"@spencer-kit/coder-studio": patch
---

Fix terminal websocket recovery so buffered PTY output is replayed after silent disconnects, including probe-based recovery and keepalive handling.
