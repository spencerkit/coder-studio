# Notice

`Notice` provides a shared presentational shell for inline info, success, warning, and error states.

- Import only from `src/components/ui/index.ts`.
- Keep message selection, alert semantics, and retry/navigation logic in feature code.
- Rendered DOM preserves the legacy `settings-page__notice*` compatibility classes used by the settings load-error notice while generic layout and tone styling live in the component CSS module.
