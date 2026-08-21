---
"@spencer-kit/coder-studio": patch
---

Reduce runtime startup blocking work by deferring more shell and bootstrap setup off the initial
path, and revalidate the server-backed workspace last viewed target before committing inactive
bootstrap prefetch state after activation resumes. This preserves the faster workspace list
prefetch path while avoiding stale workspace restoration when another tab changed the target during
inactivity.
