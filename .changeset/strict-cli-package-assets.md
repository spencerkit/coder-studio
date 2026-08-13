---
"@spencer-kit/coder-studio": patch
---

Validate the final packed CLI manifest and every declared package entry before publishing, emit the public type declaration referenced by the package exports, and isolate npm acceptance candidates under traceable `rc-<run-id>-<attempt>` dist-tags.
