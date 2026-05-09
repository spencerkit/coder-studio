# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟡 in-flight | `.btn .btn-*` | 30 | 2026-05-06 |
| IconButton | ⚫ not-started | `.btn` icon-only | — | — |
| Input | 🟢 complete | `.input` | 0 | 2026-05-09 |
| Textarea | 🟢 complete | `.input.textarea` | 0 | 2026-05-09 |
| Tag | ⚫ not-started | `.badge .badge-*` | — | — |
| Badge | ⚫ not-started | `.badge` | — | — |
| Pill | 🟢 complete | `.settings-pill*` | 0 | 2026-05-09 |
| StatusDot | ⚫ not-started | token-backed dot patterns | — | — |
| Kbd | ⚫ not-started | `kbd` | — | — |
| Spinner | ⚫ not-started | `.animate-spin` | — | — |
| Switch | ⚫ not-started | new | — | — |
| Modal | ⚫ not-started | `.modal-overlay .modal-card .modal-*` | — | — |
| ConfirmDialog | ⚫ not-started | modal convenience wrapper | — | — |
| Toast | ⚫ not-started | `.toast*` | — | — |
| Tooltip | ⚫ not-started | new | — | — |
| ProgressBar | ⚫ not-started | `--progress-height` patterns | — | — |
| Notice | 🟢 complete | `.settings-page__notice*` | 0 | 2026-05-09 |
| EmptyState | ⚫ not-started | feature-specific empty state blocks | — | — |
| Tabs | ⚫ not-started | tab / pill patterns across features | — | — |
| SegmentedControl | ⚫ not-started | `.settings-pill*` | — | — |
| Select | 🟡 in-flight | `.input`, `.mobile-select-*` | 2 | 2026-05-09 |
| Popover | ⚫ not-started | new | — | — |
| ActionMenu | ⚫ not-started | new | — | — |
| Sheet | ⚫ not-started | mobile sheet shells | — | — |

`Input` now completes the legacy `.input` single-line text-entry migration inventory: the auth password field, the settings supervisor timeout field, the git sync auth username/password fields, the worktree manager create-form branch/path fields, the file-tree create-path modal field, and the shortcuts capture input all use the shared primitive from the public UI barrel while preserving legacy `.input` compatibility classes and caller-owned layout hooks such as `auth-input`, `settings-input-compact`, and `shortcuts-capture`.

`Textarea` now completes the bounded legacy `.input.textarea` migration inventory: the provider startup-args textarea and the supervisor objective textarea both use the shared primitive from the public UI barrel while preserving legacy `input` / `textarea` compatibility classes and caller-owned hooks such as `settings-provider-args-input`. The `git-panel` commit message field is intentionally not counted on this row because it is not part of the `.input.textarea` family selected for this slice, and standalone `.textarea` utility usage remains outside this row.

`Select` now covers the bounded supervisor objective dialog evaluator-provider flow on both platforms: desktop uses the shared primitive's native `<select>` path while mobile uses its trigger mode to reopen the existing `MobileSelectSheet` flow, preserving legacy `input` / `mobile-select-trigger*` compatibility classes and the objective dialog's existing label, helper-text, and hook ids. The row remains in-flight because this slice only migrates the objective dialog evaluator-provider selector; deferred select-like callers still include the settings provider tabs/subnav families and the broader mobile select-trigger families outside this flow.

`Notice` now completes the bounded legacy `.settings-page__notice*` migration inventory: the settings-page load-error shell uses the shared primitive from the public UI barrel while preserving the legacy `settings-page__notice*` compatibility classes and the caller-owned `settings-link` refresh action styling. Other notice-like alerts such as supervisor or worktree callouts remain intentionally outside this row because they do not belong to the `.settings-page__notice*` family selected for this slice.

`Pill` now completes the bounded legacy `.settings-pill*` migration inventory: the settings appearance theme, terminal renderer, and language option groups use the shared primitive from the public UI barrel while preserving the legacy `settings-pill*` compatibility classes and the existing `settings-pills` layout hook. The primitive now owns the pill visuals locally, so the old global `.settings-pill*` style block is removed from `components.css` to avoid duplicate styling sources.
