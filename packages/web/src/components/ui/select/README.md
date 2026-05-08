# Select

Single controlled select primitive with one public API for desktop dropdown and mobile sheet presentation.

- Import from `src/components/ui/index.ts` only.
- Use `options`, `value`, `onChange`, and optional `placeholder`, `disabled`, `forceMode`, `className`, `valueClassName`, `iconClassName`.
- `forceMode` accepts `desktop` / `mobile`, with `dropdown` / `sheet` preserved as equivalent compatibility aliases.
- Mobile mode is resolved through shared `useViewport()` and reuses `MobileSelectSheet` internally.
- Preserve bounded legacy trigger classes through `className`, `valueClassName`, and `iconClassName` during migrations.
