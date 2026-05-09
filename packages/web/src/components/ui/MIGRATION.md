# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟢 complete | `.btn .btn-*` | 0 | 2026-05-09 |
| IconButton | 🟡 partial | `.btn` icon-only | bounded modal/dialog close, desktop/mobile topbar icon-only triggers, workspace fullscreen, supervisor card actions, git/file-tree row actions, mobile-select trailing side actions, agent session header actions, selected terminal/workspace flows, shortcut reset, and workspace file-toolbar actions covered; broader icon-action families remain | 2026-05-09 |
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
| EmptyState | 🟡 partial | feature-specific empty state blocks | centered shared shells plus workspace desktop/mobile no-session or no-workspace empties covered; richer workspace resolving/card shells remain | 2026-05-09 |
| Tabs | 🟢 complete | `.panel-tabs`, `.panel-tab`, `.worktree-tabs`, `.worktree-tab`, feature-local workspace/terminal tab shells | 0 | 2026-05-09 |
| SegmentedControl | 🟢 complete | `.settings-provider-tabs`, `.settings-provider-tab`, `.settings-provider-subnav`, `.settings-provider-subnav-button`, `.shortcuts-category-tabs`, `.shortcuts-category-tab` | 0 | 2026-05-09 |
| Sheet | 🟢 complete | `.mobile-sheet*` | 0 | 2026-05-09 |
| Select | 🟢 complete | `.input`, `.mobile-select-*` | 0 | 2026-05-09 |
| Popover | 🟡 partial | new | desktop terminal selector and branch quick pick covered; broader custom-content dropdown families remain | 2026-05-09 |
| ActionMenu | 🟡 partial | new | mobile workspace topbar more-actions menu covered; broader desktop/topbar/command action families remain | 2026-05-09 |

`Input` now completes the legacy `.input` single-line text-entry migration inventory: the auth password field, the settings supervisor timeout field, the git sync auth username/password fields, the worktree manager create-form branch/path fields, the file-tree create-path modal field, and the shortcuts capture input all use the shared primitive from the public UI barrel while preserving legacy `.input` compatibility classes and caller-owned layout hooks such as `auth-input`, `settings-input-compact`, and `shortcuts-capture`.

`Button` now completes the legacy `.btn` / `.btn-*` migration inventory: the remaining worktree summary/manage flows now use the shared primitive from the public UI barrel, and the previous bounded migrations across auth, config actions, supervisor dialogs, git flows, file-tree dialogs, notifications, and shared mobile/desktop shells leave no feature-local raw `.btn` callsites behind. Legacy compatibility classes remain emitted by the shared primitive for zero-regression styling while ownership stays in the component.

`IconButton` now covers a broader bounded icon-action slice: the desktop topbar add/settings/files/terminal triggers, the shared workspace fullscreen control, the mobile topbar more-actions/fullscreen triggers, the supervisor card edit/pause-resume/trigger/disable controls, the git-panel row stage/unstage/discard actions, the file-tree search/tree-row create-delete actions, the mobile-select trailing side actions, and the agent session-card / draft-launcher header controls all use the shared primitive from the public UI barrel while preserving caller-owned compatibility classes such as `topbar-add`, `topbar-btn*`, `mobile-topbar__icon-button`, `supervisor-icon-btn*`, `git-row-action`, `mobile-select-sheet__item-side-action*`, and `session-action-btn*`. Broader deferred icon-action families remain intentionally outside this slice.

`Textarea` now completes the bounded legacy `.input.textarea` migration inventory: the provider startup-args textarea and the supervisor objective textarea both use the shared primitive from the public UI barrel while preserving legacy `input` / `textarea` compatibility classes and caller-owned hooks such as `settings-provider-args-input`. The primitive also supports optional auto-resize for later adopters. The `git-panel` commit message field is intentionally not counted on this row because it is not part of the `.input.textarea` family selected for this slice, and standalone `.textarea` utility usage remains outside this row.

`Tag` now completes the bounded legacy `.badge` / `.badge-*` migration inventory: the session provider and state labels, the draft session label, the mobile select item badge, and the branch quick-pick remote badge all use the shared primitive from the public UI barrel while preserving legacy compatibility classes and caller-owned layout hooks. Other tag-like labels that do not belong to this legacy family remain intentionally outside this row.

`Badge` now completes the bounded legacy `.topbar-unread` migration inventory: the workspace tab unread counter uses the shared primitive from the public UI barrel while preserving the legacy compatibility class and count-capping behavior.

`Select` now completes the bounded selector-family migration on both platforms: supervisor uses the shared primitive's interactive trigger path with a desktop `listbox` and a primitive-owned internal inline mobile `MobileSelectSheet` flow, while the terminal switcher continues to use the bounded external mobile trigger mode so it can keep richer caller-owned sheet rows and fixed naming such as "Switch terminal". The primitive preserves legacy `input` / `mobile-select-trigger*` compatibility classes and caller-owned hooks such as `terminal-selector-btn`, and no additional plain-select callers remain in this scoped inventory. Richer custom-content families now move to `Popover` / `ActionMenu` primitives instead of plain `Select`.

`Popover` now covers a bounded desktop custom-content dropdown batch: the desktop terminal selector and workspace branch quick pick both use the shared primitive from the public UI barrel for click-to-toggle or ArrowDown-to-open trigger semantics, portaled non-modal dialog content, and outside-click / `Escape` dismissal while preserving legacy hooks such as `terminal-selector-btn`, `terminal-selector-dropdown`, `terminal-selector-item*`, `git-panel-status-strip__branch`, and `branch-quick-pick*`. The mobile fullscreen terminal switcher and mobile branch quick pick remain intentionally on their existing `Select` + `MobileSelectSheet` and global `MobileSelectSheet` paths, while menu-list composition now moves into the new shared `ActionMenu` wrapper.

`ActionMenu` now covers a bounded menu-list slice: the mobile workspace topbar replaces its direct settings icon with a shared more-actions trigger that opens a mobile `Sheet`-backed action list containing `Settings` and `Quick Actions`. The primitive owns the bounded action-list chrome and desktop menu/mobile sheet presentation, while the feature layer still owns trigger styling and command wiring such as `commandPaletteOpenAtom` and the existing settings navigation callback.

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

`EmptyState` now covers a broader bounded shell slice: config editor, terminal panel, git diff/code editor/image preview empties, the desktop workspace no-workspace shell, and the mobile agent empty shell all use the shared primitive from the public UI barrel. Richer workspace resolving/card shells and other feature-owned empty-state chromes remain intentionally deferred.

`Tabs` now complete the bounded tab-navigation inventory: workspace desktop/mobile/worktree surfaces, the topbar workspace switcher, and the desktop terminal session tabs all use the shared primitive from the public UI barrel while preserving legacy compatibility classes and feature-owned closable-tab shells where secondary close actions must remain siblings of the tab trigger for valid DOM and keyboard semantics.
