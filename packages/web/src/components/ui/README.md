# Coder Studio UI

## 总则
- 已落地的基础组件统一从 public barrel（当前文件路径为 `src/components/ui/index.ts`）引入，不允许深链到组件子路径。
- 所有颜色、间距、字号、圆角、阴影、动效必须来自 `src/styles/tokens.css`。
- 普通 UI 排版只允许使用 12 个角色 token：`heading-1` 到 `heading-6`、`body-1` 到 `body-6`。`type-label`、`type-meta`、`type-body` 等旧别名已从 token 层移除，组件和业务样式禁止使用任何旧 typography alias。
- 业务代码禁止新增 `btn btn-*`、`input`、`input textarea` 这类旧式全局 className；未迁移的遗留调用点只允许原样保留，不允许扩散。
- PC / 移动差异默认由 token 或共享内部逻辑解决，业务代码不直接写 `matchMedia`。
- PC 阻塞式 overlay 只能使用共享治理家族：短决策用 `Modal` / `ConfirmDialog`，长内容与多区块工作流用 `Drawer`，移动端流程面用 `Sheet`。
- 全局命令类桌面 overlay 只能使用 `WorkbenchLayer`；terminal / editor 这类宿主内局部 overlay 不允许借用它。

## Typography Roles
- `body-3` 是普通控件和正文默认值，适用于 `Button`、`Input`、`Textarea`、`Select`、`Tabs`、`DateTimePicker` 的主要交互文案。
- `body-5` 用于 helper、meta、tooltip、code-like supporting copy，例如 `Tooltip`、`Toast` 副文案、`Kbd`。
- `body-6` 用于紧凑标签和微文案，例如 `Tag`、`Badge`、`Pill`、`SegmentedControl`、紧凑提示。
- `heading-4` 用于 panel / modal / drawer 标题，`heading-5` 用于 empty state 或 card 级标题，`heading-6` 用于 picker 等紧凑子标题。

## 已实现组件
| Component | Tier | Public API | Notes |
|---|---|---|---|
| ActionMenu | 2 | `src/components/ui/index.ts` named export only | Shared bounded action-list shell with desktop menu/mobile sheet presentation; the current bounded feature inventory is complete |
| Button | 0 | `src/components/ui/index.ts` named export only | `primary / secondary / ghost / danger` × `sm / md / lg` |
| Badge | 0 | `src/components/ui/index.ts` named export only | Shared count badge with legacy `topbar-unread` compatibility |
| ConfirmDialog | 1 | `src/components/ui/index.ts` named export only | Shared confirm/cancel wrapper for the bounded destructive-flow slice; the current bounded feature inventory is complete |
| DateTimePicker | 1 | `src/components/ui/index.ts` named export only | Shared date-time chooser with desktop popover and mobile sheet presentation |
| Drawer | 1 | `src/components/ui/index.ts` named export only | Shared governed desktop right-side blocking surface for large detail and edit workflows; backdrop dismissal is opt-in |
| EmptyState | 1 | `src/components/ui/index.ts` named export only | Shared centered empty-state shell with `title / description / icon / action` slots; the current bounded empty-state inventory is complete |
| IconButton | 0 | `src/components/ui/index.ts` named export only | `ghost / filled` × `sm / md / lg`，保留 legacy `btn` icon-only 兼容类；当前已覆盖 bounded topbar / fullscreen / close-action slice |
| Input | 0 | `src/components/ui/index.ts` named export only | Shared single-line text entry with legacy `.input` compatibility |
| Kbd | 0 | `src/components/ui/index.ts` named export only | Shared keyboard shortcut primitive with legacy `.shortcuts-key` compatibility |
| Modal | 1 | `src/components/ui/index.ts` named export only | `Modal` + `ModalHeader / ModalTitle / ModalBody / ModalFooter`，保留 legacy `modal-*` 兼容类 |
| Notice | 1 | `src/components/ui/index.ts` named export only | Current bounded slice covers the settings load-error notice family |
| Pill | 1 | `src/components/ui/index.ts` named export only | Current bounded slice covers the settings appearance option groups |
| Popover | 2 | `src/components/ui/index.ts` named export only | Current bounded feature inventory is complete for desktop anchored custom-content dropdowns; menu-list composition lives in `ActionMenu` |
| ProgressBar | 1 | `src/components/ui/index.ts` named export only | Shared bounded linear progress shell with optional ARIA progress semantics |
| SegmentedControl | 1 | `src/components/ui/index.ts` named export only | Shared compact selector used by provider chooser/subnav and shortcuts categories |
| Select | 2 | `src/components/ui/index.ts` named export only | Current bounded slice now completes the scoped selector family for supervisor and terminal mobile-sheet trigger flows |
| Sheet | 2 | `src/components/ui/index.ts` named export only | Shared bounded mobile bottom-sheet shell preserving `.mobile-sheet*` compatibility DOM |
| LocalOverlay | 1 | `src/components/ui/index.ts` named export only | Shared host-scoped runtime overlay shell for terminal/editor/panel-local status and dialog states; status overlays stay pass-through and dialog dismissal is opt-in |
| Spinner | 0 | `src/components/ui/index.ts` named export only | Shared loading indicator with legacy `.animate-spin` compatibility |
| StatusDot | 0 | `src/components/ui/index.ts` named export only | Shared token-backed status dot primitive |
| Switch | 0 | `src/components/ui/index.ts` named export only | Shared boolean switch used by bounded settings toggle flows |
| Tabs | 1 | `src/components/ui/index.ts` named export only | Controlled `Tabs / TabList / Tab / TabPanel` shell for bounded content switching |
| Tag | 0 | `src/components/ui/index.ts` named export only | Shared status tag primitive with legacy `.badge` / `.badge-*` compatibility |
| Textarea | 0 | `src/components/ui/index.ts` named export only | Shared multiline text entry with legacy `.input.textarea` compatibility and optional `autoResize` |
| Toast | 1 | `src/components/ui/index.ts` named export only | `Toast` + `ToastViewport` presentational primitives，队列/计时/导航留在 feature 层 |
| Tooltip | 1 | `src/components/ui/index.ts` named export only | Current bounded slice covers branch picker plus selected code-editor, file-tree, git-diff, fullscreen, and topbar actions |
| WorkbenchLayer | 1 | `src/components/ui/index.ts` named export only | Shared governed desktop global command-surface shell for command palette, launcher, and similar workspace-level overlays |

## 迁移状态
见 `./MIGRATION.md`。
