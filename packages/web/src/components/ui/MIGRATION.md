# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟢 complete | `.btn .btn-*` | 0 | 2026-05-09 |
| IconButton | 🟡 partial | `.btn` icon-only | bounded modal/dialog close, selected topbar/workspace/terminal icon-action flows, shortcut reset, and workspace file-toolbar actions covered; broader icon-action families remain | 2026-05-09 |
| Input | 🟢 complete | `.input` | 0 | 2026-05-09 |
| Textarea | 🟢 complete | `.input.textarea` | 0 | 2026-05-09 |
| Tag | 🟢 complete | `.badge .badge-*` | 0 | 2026-05-09 |
| Badge | 🟢 complete | `.topbar-unread` | 0 | 2026-05-09 |
| Pill | 🟢 complete | `.settings-pill*` | 0 | 2026-05-09 |
| StatusDot | 🟢 complete | `.session-dot*`, `.connection-status-dot*` | 0 | 2026-05-09 |
| Kbd | 🟢 complete | `kbd`, `.shortcuts-key` | 0 | 2026-05-09 |
| Spinner | 🟢 complete | `.animate-spin` | 0 | 2026-05-09 |
| Switch | 🟢 complete | new | 0 | 2026-05-09 |
| Modal | 🟢 complete | `.modal-overlay .modal-card .modal-*` | 0 | 2026-05-09 |
| ConfirmDialog | 🟡 partial | modal convenience wrapper | richer confirm/auth flows remain on raw `Modal` | 2026-05-09 |
| Toast | 🟢 complete | `.toast*` | 0 | 2026-05-09 |
| Tooltip | 🟡 partial | native `title` hover labels | branch picker, code-editor actions, file-tree actions, git-diff close, fullscreen, topbar actions, connection-status, git status-strip branch, session/supervisor actions, selected settings actions, and workspace/terminal file-toolbar actions covered; truncation/path and other non-action long-text titles remain deferred | 2026-05-09 |
| ProgressBar | 🟢 complete | `--progress-height` patterns | 0 | 2026-05-09 |
| Notice | 🟢 complete | `.settings-page__notice*` | 0 | 2026-05-09 |
| EmptyState | 🟡 partial | feature-specific empty state blocks | bounded centered empty-state shells covered; broader workspace empty shells remain | 2026-05-09 |
| Tabs | 🟡 partial | tab / pill patterns across features | workspace desktop/mobile/worktree bounded slice covered; broader navigation families remain | 2026-05-09 |
| SegmentedControl | 🟢 complete | `.settings-provider-tabs`, `.settings-provider-tab`, `.settings-provider-subnav`, `.settings-provider-subnav-button`, `.shortcuts-category-tabs`, `.shortcuts-category-tab` | 0 | 2026-05-09 |
| Sheet | 🟢 complete | `.mobile-sheet*` | 0 | 2026-05-09 |
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

`StatusDot` now completes the bounded legacy status-dot inventory: the agent session cards, draft launcher, and topbar connection status all use the shared primitive with caller-owned layout hooks preserved, and no feature-local `session-dot*` / `connection-status-dot*` callsites remain outside shared adopters.

`Spinner` now completes the bounded legacy `.animate-spin` migration inventory: feature callers use the shared primitive, and the only remaining `animate-spin` emission lives inside shared UI primitives for compatibility (`Spinner` itself and `Button` loading state). The workspace launch modal and settings config-editor loading states both use the shared primitive while preserving the legacy class for zero-regression styling.

`Modal` now completes the legacy raw modal-shell migration inventory: the file tree create flow, the objective dialog, the git sync auth flow, the desktop worktree modal, and the desktop worktree manager surface all use the shared primitive from the public UI barrel while preserving the legacy `modal-*` compatibility classes emitted by the primitive itself.

`ConfirmDialog` now covers the bounded confirm-action slice used by the file tree delete flow and git sync confirm dialogs. The row remains partial because richer auth and action-confirmation flows still live on direct `Modal` composition by design.

`Toast` now covers the bounded notification presenter in `features/notifications/toast-container.tsx`. The shared primitive owns the generic shell and compatibility classes, while Jotai queue state, auto-dismiss timing, icon selection, and workspace/session navigation remain in the feature layer by design.

`Switch` now completes the bounded boolean-toggle inventory: the settings notifications toggles use the shared primitive from the public UI barrel, and no additional feature-local switch implementations remain in the selected scope.

`Tooltip` now covers a broader bounded action-trigger batch: branch picker, topbar/workspace fullscreen, selected code-editor actions, file-tree delete/create actions, git-diff close, connection-status hover copy, the git status-strip branch trigger, session/supervisor actions, the settings config-editor format action, workspace desktop/mobile file-toolbar actions, and terminal toolbar open/close actions all use the shared primitive from the public UI barrel. The shared primitive also preserves hover help for real disabled button triggers so these migrations do not regress existing affordances. Deferred tooltip-like families such as truncation/path and other non-action long-text titles remain intentionally outside this slice.

`Sheet` now completes the mobile sheet-shell migration inventory: the mobile workspace files and terminal fullscreen sheets, mobile supervisor flows, mobile select sheet presentation, mobile worktree manager surface, workspace launch modal, worktree modal, and command palette all use the shared primitive from the public UI barrel while preserving the existing `mobile-sheet*` compatibility classes and caller-owned body/content modifiers.

`ProgressBar` now completes the bounded linear progress inventory: the agent session card progress meter uses the shared primitive from the public UI barrel while preserving the existing `session-progress*` compatibility hooks, and no additional feature-local `--progress-height` progress families remain in scope.

`SegmentedControl` now completes the bounded selector-family inventory: provider chooser tabs, provider sub-navigation, and shortcuts category selectors all use the shared primitive from the public UI barrel while preserving the existing legacy compatibility classes for zero-regression styling.

`EmptyState` and `Tabs` now have shared primitives in the public barrel and bounded caller adoption on `develop`, but their broader feature-specific families are not yet fully migrated across the inventory.
