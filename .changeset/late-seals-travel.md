"@spencer-kit/coder-studio": patch
---

Refactor the CLI entry structure so the executable wrapper only launches the command entrypoint, while the reusable CLI logic lives in a separate module. This fixes cases where globally installed `coder-studio` commands could fail to print output because the entry module was misdetected.
