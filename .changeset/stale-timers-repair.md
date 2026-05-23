---
"@spencer-kit/coder-studio": patch
---

Fix terminal recovery so session output no longer stalls after noop reconcile
decisions or gets cleared when queued live chunks flush after snapshot
hydration.
