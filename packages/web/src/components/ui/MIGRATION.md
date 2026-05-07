# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟡 in-flight | `.btn .btn-*` | 30 | 2026-05-06 |
| IconButton | ⚫ not-started | `.btn` icon-only | — | — |
| Input | 🟢 complete | `.input` | 0 | 2026-05-07 |
| Textarea | 🟢 complete | `.input.textarea` | 0 | 2026-05-07 |
| Tag | ⚫ not-started | `.badge .badge-*` | — | — |
| Badge | ⚫ not-started | `.badge` | — | — |
| Pill | ⚫ not-started | `.settings-pill*` | — | — |
| StatusDot | ⚫ not-started | token-backed dot patterns | — | — |
| Kbd | ⚫ not-started | `kbd` | — | — |
| Spinner | ⚫ not-started | `.animate-spin` | — | — |
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
