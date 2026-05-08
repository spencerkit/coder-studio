# Coder Studio UI

## 总则
- 已落地的基础组件统一从 public barrel（当前文件路径为 `src/components/ui/index.ts`）引入，不允许深链到组件子路径。
- 所有颜色、间距、字号、圆角、阴影、动效必须来自 `src/styles/tokens.css`。
- 业务代码禁止新增 `btn btn-*`、`input`、`input textarea` 这类旧式全局 className；未迁移的遗留调用点只允许原样保留，不允许扩散。
- PC / 移动差异默认由 token 或共享内部逻辑解决，业务代码不直接写 `matchMedia`。

## 已实现组件
| Component | Tier | Public API | Notes |
|---|---|---|---|
| Button | 0 | `src/components/ui/index.ts` named export only | `primary / secondary / ghost / danger` × `sm / md / lg` |
| Badge | 0 | `src/components/ui/index.ts` named export only | Shared count badge with legacy `topbar-unread` compatibility |
| ConfirmDialog | 1 | `src/components/ui/index.ts` named export only | Shared confirm/cancel wrapper used by bounded destructive flows |
| EmptyState | 1 | `src/components/ui/index.ts` named export only | Shared centered empty-state shell with `title / description / icon / action` slots |
| IconButton | 0 | `src/components/ui/index.ts` named export only | `ghost / filled` × `sm / md / lg`，保留 legacy `btn` icon-only 兼容类 |
| Input | 0 | `src/components/ui/index.ts` named export only | Shared single-line text entry with legacy `.input` compatibility |
| Kbd | 0 | `src/components/ui/index.ts` named export only | Shared keyboard shortcut primitive with legacy `.shortcuts-key` compatibility |
| Modal | 1 | `src/components/ui/index.ts` named export only | `Modal` + `ModalHeader / ModalTitle / ModalBody / ModalFooter`，保留 legacy `modal-*` 兼容类 |
| Notice | 1 | `src/components/ui/index.ts` named export only | Current bounded slice covers the settings load-error notice family |
| Pill | 1 | `src/components/ui/index.ts` named export only | Current bounded slice covers the settings appearance option groups |
| ProgressBar | 1 | `src/components/ui/index.ts` named export only | Shared bounded linear progress shell with optional ARIA progress semantics |
| SegmentedControl | 1 | `src/components/ui/index.ts` named export only | Shared compact selector used by provider chooser/subnav and shortcuts categories |
| Select | 2 | `src/components/ui/index.ts` named export only | Current bounded slice covers the supervisor evaluator selector family |
| Sheet | 2 | `src/components/ui/index.ts` named export only | Shared bounded mobile bottom-sheet shell preserving `.mobile-sheet*` compatibility DOM |
| Spinner | 0 | `src/components/ui/index.ts` named export only | Shared loading indicator with legacy `.animate-spin` compatibility |
| StatusDot | 0 | `src/components/ui/index.ts` named export only | Shared token-backed status dot primitive |
| Switch | 0 | `src/components/ui/index.ts` named export only | Shared boolean switch used by bounded settings toggle flows |
| Tabs | 1 | `src/components/ui/index.ts` named export only | Controlled `Tabs / TabList / Tab / TabPanel` shell for bounded content switching |
| Tag | 0 | `src/components/ui/index.ts` named export only | Shared status tag primitive with legacy `.badge` / `.badge-*` compatibility |
| Textarea | 0 | `src/components/ui/index.ts` named export only | Shared multiline text entry with legacy `.input.textarea` compatibility and optional `autoResize` |
| Toast | 1 | `src/components/ui/index.ts` named export only | `Toast` + `ToastViewport` presentational primitives，队列/计时/导航留在 feature 层 |
| Tooltip | 1 | `src/components/ui/index.ts` named export only | Current bounded slice covers branch picker plus selected code-editor, file-tree, git-diff, fullscreen, and topbar actions |

## 迁移状态
见 `./MIGRATION.md`。
