# EmptyState

`EmptyState` provides a shared presentational shell for bounded centered empty states.

- Import only from `src/components/ui/index.ts`.
- Keep loading, routing, file selection, terminal creation, and other feature behavior in caller code.
- Compose any legacy compatibility classes at the caller via `className` and the `title` / `description` / `icon` / `action` slots.
