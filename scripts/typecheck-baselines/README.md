# Typecheck baselines

The Web package currently has known TypeScript diagnostics that predate enforcement in CI. The
committed baseline allows only those exact diagnostics, including their file, error code, message,
and occurrence count. Any new diagnostic fails `pnpm ci:typecheck`, even when another existing error
was fixed in the same change.

Fixing baseline diagnostics does not require an immediate baseline update: the check reports the
resolved count and continues to pass. After intentionally fixing existing debt, shrink the baseline
with:

```sh
pnpm exec tsx scripts/check-typecheck-baseline.ts --update
```

Do not update the baseline to accept new errors.
