# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟡 in-flight | `.btn .btn-*` | 30 | 2026-05-06 |
| IconButton | ⚫ not-started | `.btn` icon-only | — | — |
| Input | 🟢 complete | `.input` | 0 | 2026-05-07 |
| Textarea | 🟢 complete | `.input.textarea` | 0 | 2026-05-07 |
| Tag | 🟡 in-flight | `.badge .badge-*` | 0 | 2026-05-07 |
| Badge | 🟡 in-flight | `.topbar-unread` | 0 | 2026-05-07 |
| Pill | 🟡 in-flight | `.settings-pill*` | 0 | 2026-05-07 |
| StatusDot | 🟡 in-flight | `.session-dot*`, `.connection-status-dot*` | 0 | 2026-05-07 |
| Kbd | 🟡 in-flight | `kbd`, `.shortcuts-key` | 0 | 2026-05-07 |
| Spinner | 🟡 in-flight | `.animate-spin` | 1 | 2026-05-07 |
| Switch | ⚫ not-started | new | — | — |
| Modal | ⚫ not-started | `.modal-overlay .modal-card .modal-*` | — | — |
| ConfirmDialog | ⚫ not-started | modal convenience wrapper | — | — |
| Toast | ⚫ not-started | `.toast*` | — | — |
| Tooltip | ⚫ not-started | new | — | — |
| ProgressBar | ⚫ not-started | `--progress-height` patterns | — | — |
| Notice | ⚫ not-started | `.settings-page__notice*` | — | — |
| EmptyState | ⚫ not-started | feature-specific empty state blocks | — | — |
| Tabs | ⚫ not-started | tab / pill patterns across features | — | — |
| SegmentedControl | ⚫ not-started | `.settings-pill*` | — | — |
| Select | ⚫ not-started | `.input`, `.mobile-select-*` | — | — |
| Popover | ⚫ not-started | new | — | — |
| ActionMenu | ⚫ not-started | new | — | — |
| Sheet | ⚫ not-started | mobile sheet shells | — | — |

`Input` / `Textarea` caller counts only include raw native text-entry controls that should migrate to those shared primitives. They intentionally exclude `select.input`, `button.input`, search-model controls, and checkbox/radio inputs.

`Pill` / `Kbd` counts only cover the bounded settings callers in this slice. `Tag` covers the bounded `.badge` family callers plus the selected selector labels in this slice; it intentionally excludes deferred badge-like families such as supervisor and git-row state labels. `Badge` covers the bounded topbar unread count caller only. `StatusDot` excludes mobile-only and other feature-specific dot variants deferred by the phase-d plan, so the selected family callers in this slice are now fully migrated. `Spinner` excludes the internal `Button` loading spinner and leaves the remaining feature-specific `animate-spin` usage for a later slice.
