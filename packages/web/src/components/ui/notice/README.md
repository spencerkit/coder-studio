# Notice

`Notice` provides a shared presentational shell for inline status, warning, success, and error messages.

- Import only from `src/components/ui/index.ts`.
- Keep message selection, refresh/navigation logic, and dismissal state in feature code.
- Rendered DOM preserves legacy settings and config-drift notice compatibility classes while generic styling lives in the component CSS module.
