# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | 🟢 complete | `.btn .btn-*` | 0 | 2026-05-09 |
| IconButton | 🟢 complete | `.btn` icon-only | 0 | 2026-05-09 |
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
| ConfirmDialog | 🟡 partial | modal convenience wrapper | file-tree delete, git sync confirm dialogs, and worktree-manager delete confirmation covered; richer confirm/auth flows remain on raw `Modal` | 2026-05-09 |
| Toast | 🟢 complete | `.toast*` | 0 | 2026-05-09 |
| Tooltip | 🟢 complete | native `title` hover labels | 0 | 2026-05-09 |
| ProgressBar | 🟢 complete | `--progress-height` patterns | 0 | 2026-05-09 |
| Notice | 🟢 complete | `.settings-page__notice*` | 0 | 2026-05-09 |
| EmptyState | 🟡 partial | feature-specific empty state blocks | centered shared shells plus workspace desktop/mobile no-session or no-workspace empties, welcome/not-found page shells, agent-panes no-workspace, topbar no-workspace, workspace route resolving/load-failed shells, worktree detail no-diff and empty-tree states, worktree manager list-empty, workspace launch directory-empty, command palette no-results, desktop branch quick-pick loading/idle/filter-empty states, shared git-panel compact worktree/change/history shells, file-tree-panel loading/search-empty/tree fallback shells, the mobile select empty shell, and the mobile supervisor enable shell covered; additional list-style and other feature-owned empty blocks remain | 2026-05-09 |
| Tabs | 🟢 complete | `.panel-tabs`, `.panel-tab`, `.worktree-tabs`, `.worktree-tab`, feature-local workspace/terminal tab shells | 0 | 2026-05-09 |
| SegmentedControl | 🟢 complete | `.settings-provider-tabs`, `.settings-provider-tab`, `.settings-provider-subnav`, `.settings-provider-subnav-button`, `.shortcuts-category-tabs`, `.shortcuts-category-tab` | 0 | 2026-05-09 |
| Sheet | 🟢 complete | `.mobile-sheet*` | 0 | 2026-05-09 |
| Select | 🟢 complete | `.input`, `.mobile-select-*` | 0 | 2026-05-09 |
| Popover | 🟡 partial | new | desktop terminal selector and branch quick pick covered; broader custom-content dropdown families remain | 2026-05-09 |
| ActionMenu | 🟡 partial | new | mobile workspace topbar more-actions menu covered; broader desktop/topbar/command action families remain | 2026-05-09 |

`Input` now completes the legacy `.input` single-line text-entry migration inventory: the auth password field, the settings supervisor timeout field, the git sync auth username/password fields, the worktree manager create-form branch/path fields, the file-tree create-path modal field, and the shortcuts capture input all use the shared primitive from the public UI barrel while preserving legacy `.input` compatibility classes and caller-owned layout hooks such as `auth-input`, `settings-input-compact`, and `shortcuts-capture`.

`Button` now completes the legacy `.btn` / `.btn-*` migration inventory: the remaining worktree summary/manage flows now use the shared primitive from the public UI barrel, and the previous bounded migrations across auth, config actions, supervisor dialogs, git flows, file-tree dialogs, notifications, and shared mobile/desktop shells leave no feature-local raw `.btn` callsites behind. Legacy compatibility classes remain emitted by the shared primitive for zero-regression styling while ownership stays in the component.

`IconButton` now completes the feature-layer raw icon-only action-trigger inventory. The remaining desktop/mobile topbar icon-only triggers, shared workspace fullscreen control, supervisor card actions, git/file-tree/status-row actions, code-editor and git-diff close chrome, modal/dialog and toast close controls, mobile-select trailing side actions, terminal/workspace tab and selector close controls, shortcut reset, mobile workspace drawer close, and workspace file-toolbar actions all use the shared primitive from the public UI barrel while preserving caller-owned compatibility classes such as `topbar-add`, `topbar-btn*`, `mobile-topbar__icon-button`, `supervisor-icon-btn*`, `git-row-action`, `git-status-bar__item*`, `code-mode-btn`, `mobile-sheet__action--icon`, `toast__close`, `launch-close-btn`, `mobile-workspace-drawer__item-close`, `mobile-select-sheet__item-side-action*`, `session-action-btn*`, `topbar-close`, `terminal-tab-close`, and `terminal-selector-item-close`. The remaining raw feature buttons audited on this pass are intentionally not counted on this row because they are text-bearing buttons, tabs/selectors, counters, backdrops, or other specialized controls rather than icon-only action triggers.

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

`ConfirmDialog` now covers the bounded confirm-action slice used by the file tree delete flow, git sync confirm dialogs, and the worktree-manager delete confirmation. The row remains partial because richer auth and action-confirmation flows still live on direct `Modal` composition by design.

`Toast` now covers the bounded notification presenter in `features/notifications/toast-container.tsx`. The shared primitive owns the generic shell and compatibility classes, while Jotai queue state, auto-dismiss timing, icon selection, and workspace/session navigation remain in the feature layer by design.

`Switch` now completes the bounded boolean-toggle inventory: the settings notifications toggles use the shared primitive from the public UI barrel, and no additional feature-local switch implementations remain in the selected scope.

`Tooltip` now completes the feature-layer native hover-label migration inventory: the earlier action-trigger adoptions plus the remaining file-tree path labels, git history subjects, workspace tab path labels, settings config path labels, and supervisor objective text all use the shared primitive from the public UI barrel instead of native `title` attributes. The shared primitive also preserves hover help for real disabled button triggers so these migrations do not regress existing affordances, and no feature-local native `title` hover-label callsites remain.

`Sheet` now completes the mobile sheet-shell migration inventory: the mobile workspace files and terminal fullscreen sheets, mobile supervisor flows, mobile select sheet presentation, mobile worktree manager surface, workspace launch modal, worktree modal, and command palette all use the shared primitive from the public UI barrel while preserving the existing `mobile-sheet*` compatibility classes and caller-owned body/content modifiers.

`ProgressBar` now completes the bounded linear progress inventory: the agent session card progress meter uses the shared primitive from the public UI barrel while preserving the existing `session-progress*` compatibility hooks, and no additional feature-local `--progress-height` progress families remain in scope.

`SegmentedControl` now completes the bounded selector-family inventory: provider chooser tabs, provider sub-navigation, and shortcuts category selectors all use the shared primitive from the public UI barrel while preserving the existing legacy compatibility classes for zero-regression styling.

`EmptyState` now covers a broader bounded shell slice: config editor, terminal panel, git diff/code editor/image preview empties, the desktop workspace no-workspace shell, the welcome and not-found page shells, the agent-panes no-workspace shell, the topbar no-workspace hint, the worktree detail no-diff and empty-tree states, the worktree manager list-empty state, the workspace launch directory-empty state, the command palette no-results state, the desktop branch quick-pick loading and compact empty-result states, the shared git-panel compact worktree/change/history shells, the shared file-tree-panel loading/search-empty/tree fallback shells, the mobile agent empty shell, the mobile select empty shell, the mobile supervisor enable shell, and the workspace route resolving/load-failed shells all use the shared primitive from the public UI barrel while preserving feature-owned chrome such as `welcome-container*`, `welcome-card*`, `welcome-kicker`, `welcome-title`, `welcome-body`, `auth-status-panel`, `workspace-resolving-shell`, `workspace-resolving-card`, `agent-panes-empty`, `topbar-empty-state`, `mobile-select-sheet__empty`, `mobile-supervisor-sheet__empty`, `worktree-empty`, `directory-empty`, `command-palette-empty`, `branch-quick-pick-empty`, `git-panel-empty`, and `file-tree-empty`. Additional list-style and other feature-owned empty-state chromes remain intentionally deferred.

`Tabs` now complete the bounded tab-navigation inventory: workspace desktop/mobile/worktree surfaces, the topbar workspace switcher, and the desktop terminal session tabs all use the shared primitive from the public UI barrel while preserving legacy compatibility classes and feature-owned closable-tab shells where secondary close actions must remain siblings of the tab trigger for valid DOM and keyboard semantics.
