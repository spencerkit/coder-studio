# Notice

`Notice` provides a shared presentational shell for inline status, warning, success, and error messages.

- Import only from `src/components/ui/index.ts`.
- Keep message selection and refresh/navigation logic in feature code.
- Rendered DOM preserves the legacy `settings-page__notice*` compatibility classes used by the settings load-error notice while generic styling lives in the component CSS module.
