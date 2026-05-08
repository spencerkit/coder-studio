# Toast

`Toast` and `ToastViewport` provide the shared presentational shell for transient notifications.

- Import only from `src/components/ui/index.ts`.
- Keep notification queue, timers, and navigation logic in feature code.
- Rendered DOM preserves legacy `.toast*` compatibility classes while styles live in the component CSS module.
