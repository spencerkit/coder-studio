# LSP smoke-test fixtures

A small set of single-file projects used to verify each managed LSP works end-to-end against the editor (hover / definition / references / diagnostics). Each file has a TYPE ERROR at the bottom on purpose so the diagnostic provider also gets exercised.

| File | Language server | What to verify |
| --- | --- | --- |
| `probe.vue` | `@vue/language-server` (Volar 3) + `typescript-language-server` companion | hover on `ref`/`computed`/`defineProps`, F12 to `Props`, red squiggle on the type error |
| `probe.py` | `python-lsp-server` (pylsp, managed) | hover on `multiply_by`/`Greeter`, F12 across functions, pyflakes-level diagnostic |
| `probe.go` | `gopls` (managed) | hover on `MultiplyBy`/`Greeter.Greet`, F12 across functions, type-mismatch diagnostic |
| `probe.rs` + `Cargo.toml` | `rust-analyzer` (system rustup component or managed download) | hover on `multiply_by`/`Greeter`/`greet`, F12 across functions, type-mismatch diagnostic |

## Why a `Cargo.toml`

Unlike the other servers, **rust-analyzer refuses to provide semantic info for `.rs` files that don't belong to a Cargo project**. The minimal `Cargo.toml` in this directory declares `probe.rs` as a bin so rust-analyzer treats the directory as a workspace.

> rust-analyzer also takes ~25s on cold start to finish `PrimeCaches` indexing, during which all hover/definition requests silently return `null`. See `docs/issue/rust-analyzer-indexing-no-progress-feedback.md`.

## How to run

1. Open coder-studio in the editor (dev or built).
2. Open any file in this directory.
3. First open triggers the LSP install if needed — look for the `Install` button in the inline notice.
4. Once the notice disappears, exercise the four LSP features listed above.

For protocol-level debugging without the editor in the loop, see `scripts/probe-vue-bridge.mjs` and `scripts/probe-rust.mjs` — they spawn the language server directly and assert specific LSP responses.

## Cleanup

These fixtures are intentionally checked in so a new contributor can repeat the same smoke check on day one. Feel free to leave them in place; they don't affect any production build.
