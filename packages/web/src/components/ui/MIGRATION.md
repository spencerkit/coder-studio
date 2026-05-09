# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟢 complete | `.btn .btn-*` | 0 | 2026-05-09 |
| IconButton | 🟡 partial | `.btn` icon-only | bounded modal/dialog close and shortcut reset flows covered; broader icon-action families remain | 2026-05-09 |
| Input | 🟢 complete | `.input` | 0 | 2026-05-09 |
| Textarea | 🟢 complete | `.input.textarea` | 0 | 2026-05-09 |
| Tag | 🟢 complete | `.badge .badge-*` | 0 | 2026-05-09 |
| Badge | 🟢 complete | `.topbar-unread` | 0 | 2026-05-09 |
| Pill | 🟢 complete | `.settings-pill*` | 0 | 2026-05-09 |
| StatusDot | 🟡 partial | `.session-dot*`, `.connection-status-dot*` | 0 | 2026-05-09 |
| Kbd | 🟢 complete | `kbd`, `.shortcuts-key` | 0 | 2026-05-09 |
| Spinner | 🟢 complete | `.animate-spin` | 0 | 2026-05-09 |
| Switch | 🟡 partial | new | bounded settings notification toggles covered | 2026-05-09 |
| Modal | 🟡 partial | `.modal-overlay .modal-card .modal-*` | raw modal families still exist outside current bounded callers | 2026-05-09 |
| ConfirmDialog | 🟡 partial | modal convenience wrapper | richer confirm/auth flows remain on raw `Modal` | 2026-05-09 |
| Toast | 🟢 complete | `.toast*` | 0 | 2026-05-09 |
| Tooltip | 🟡 partial | native `title` hover labels | branch picker, code-editor actions, file-tree actions, git-diff close, fullscreen, topbar actions, session/supervisor icon actions, and workspace/terminal file-toolbar actions covered; truncation/path, connection-status/container, git-panel remain deferred | 2026-05-09 |
| ProgressBar | 🟡 partial | `--progress-height` patterns | broader progress families remain deferred | 2026-05-09 |
| Notice | 🟢 complete | `.settings-page__notice*` | 0 | 2026-05-09 |
| EmptyState | 🟡 partial | feature-specific empty state blocks | bounded centered empty-state shells covered; broader workspace empty shells remain | 2026-05-09 |
| Tabs | 🟡 partial | tab / pill patterns across features | workspace desktop/mobile/worktree bounded slice covered; broader navigation families remain | 2026-05-09 |
| SegmentedControl | 🟡 partial | `.settings-provider-tabs`, `.settings-provider-tab`, `.settings-provider-subnav`, `.settings-provider-subnav-button`, `.shortcuts-category-tabs`, `.shortcuts-category-tab` | bounded settings selector families covered | 2026-05-09 |
| Sheet | 🟡 partial | `.mobile-sheet*` | shared worktree/workspace-launch bounded slice covered; richer mobile sheet families remain | 2026-05-09 |
| Select | 🟡 in-flight | `.input`, `.mobile-select-*` | 2 | 2026-05-09 |
| Popover | ⚫ not-started | new | — | — |
| ActionMenu | ⚫ not-started | new | — | — |

`Input` now completes the legacy `.input` single-line text-entry migration inventory: the auth password field, the settings supervisor timeout field, the git sync auth username/password fields, the worktree manager create-form branch/path fields, the file-tree create-path modal field, and the shortcuts capture input all use the shared primitive from the public UI barrel while preserving legacy `.input` compatibility classes and caller-owned layout hooks such as `auth-input`, `settings-input-compact`, and `shortcuts-capture`.

`Button` now completes the legacy `.btn` / `.btn-*` migration inventory: the remaining worktree summary/manage flows now use the shared primitive from the public UI barrel, and the previous bounded migrations across auth, config actions, supervisor dialogs, git flows, file-tree dialogs, notifications, and shared mobile/desktop shells leave no feature-local raw `.btn` callsites behind. Legacy compatibility classes remain emitted by the shared primitive for zero-regression styling while ownership stays in the component.

`Textarea` now completes the bounded legacy `.input.textarea` migration inventory: the provider startup-args textarea and the supervisor objective textarea both use the shared primitive from the public UI barrel while preserving legacy `input` / `textarea` compatibility classes and caller-owned hooks such as `settings-provider-args-input`. The primitive also supports optional auto-resize for later adopters. The `git-panel` commit message field is intentionally not counted on this row because it is not part of the `.input.textarea` family selected for this slice, and standalone `.textarea` utility usage remains outside this row.

`Tag` now completes the bounded legacy `.badge` / `.badge-*` migration inventory: the session provider and state labels, the draft session label, the mobile select item badge, and the branch quick-pick remote badge all use the shared primitive from the public UI barrel while preserving legacy compatibility classes and caller-owned layout hooks. Other tag-like labels that do not belong to this legacy family remain intentionally outside this row.

`Badge` now completes the bounded legacy `.topbar-unread` migration inventory: the workspace tab unread counter uses the shared primitive from the public UI barrel while preserving the legacy compatibility class and count-capping behavior.

`Select` now covers the bounded supervisor objective dialog evaluator-provider flow on both platforms: desktop uses the shared primitive's native `<select>` path while mobile uses its trigger mode to reopen the existing `MobileSelectSheet` flow, preserving legacy `input` / `mobile-select-trigger*` compatibility classes and the objective dialog's existing label, helper-text, and hook ids. The row remains in-flight because this slice only migrates the objective dialog evaluator-provider selector; deferred select-like callers still include other broader selector families outside this flow.

`Notice` now completes the bounded legacy `.settings-page__notice*` migration inventory: the settings-page load-error shell uses the shared primitive from the public UI barrel while preserving the legacy `settings-page__notice*` compatibility classes and the caller-owned `settings-link` refresh action styling.

`Pill` now completes the bounded legacy `.settings-pill*` migration inventory: the settings appearance theme, terminal renderer, and language option groups use the shared primitive from the public UI barrel while preserving the legacy `settings-pill*` compatibility classes and the existing `settings-pills` layout hook. The primitive now owns the pill visuals locally, so the old global `.settings-pill*` style block is removed from `components.css` to avoid duplicate styling sources.

`Kbd` now completes the bounded keyboard-shortcut display slice: the settings shortcut bindings use the shared primitive from the public UI barrel while preserving the legacy `.shortcuts-key` compatibility class and interactive keyboard semantics.

`StatusDot` now covers the bounded desktop status-indicator slice: the agent session cards and topbar connection status use the shared primitive with caller-owned layout hooks preserved. The row remains partial because other dot variants outside this bounded slice remain deferred.

`Spinner` now completes the bounded legacy `.animate-spin` migration inventory: feature callers use the shared primitive, and the only remaining `animate-spin` emission lives inside shared UI primitives for compatibility (`Spinner` itself and `Button` loading state). The workspace launch modal and settings config-editor loading states both use the shared primitive while preserving the legacy class for zero-regression styling.

`Modal` and `ConfirmDialog` now cover the bounded desktop dialog slice used by the file tree create/delete flows, the objective dialog, the git sync confirm/auth dialogs, and the desktop worktree modal. These rows remain partial because richer modal families and some mobile dialog flows are intentionally still outside this bounded slice.

`Toast` now covers the bounded notification presenter in `features/notifications/toast-container.tsx`. The shared primitive owns the generic shell and compatibility classes, while Jotai queue state, auto-dismiss timing, icon selection, and workspace/session navigation remain in the feature layer by design.

`Tooltip` now covers a broader bounded icon-trigger batch: branch picker, topbar/workspace fullscreen, selected code-editor actions, file-tree delete/create actions, git-diff close, session/supervisor header actions, workspace desktop/mobile file-toolbar actions, and terminal toolbar open/close actions all use the shared primitive from the public UI barrel. The shared primitive also preserves hover help for real disabled button triggers so these migrations do not regress existing affordances. Deferred tooltip-like families such as connection-status container labels, git-panel action families, and truncation/path titles remain intentionally outside this slice.

`ProgressBar`, `EmptyState`, `Tabs`, `SegmentedControl`, `Switch`, and `Sheet` now have shared primitives in the public barrel and bounded caller adoption on `develop`, but they are not yet broad enough to count as fully complete across the migration inventory.
