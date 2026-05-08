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
| Badge | 0 | `src/components/ui/index.ts` named export only | `count / max`，count-only，保留 legacy `topbar-unread` 兼容类 |
| Input | 0 | `src/components/ui/index.ts` named export only | `sm / md / lg`，保留 legacy `input` 兼容类 |
| IconButton | 0 | `src/components/ui/index.ts` named export only | `ghost / filled` × `sm / md / lg`，`aria-label` 必填，保留 legacy `btn` icon-only 兼容类 |
| Kbd | 0 | `src/components/ui/index.ts` named export only | `sm / md`，保留 legacy `shortcuts-key` 兼容类 |
| Modal | 1 | `src/components/ui/index.ts` named export only | `Modal` + `ModalHeader / ModalTitle / ModalBody / ModalFooter`，保留 legacy `modal-*` 兼容类 |
| Notice | 1 | `src/components/ui/index.ts` named export only | inline presentational notice shell，`info / success / warning / error`，保留 `settings-page__notice*` 与 `config-drift-banner__notice` 兼容类 |
| ConfirmDialog | 1 | `src/components/ui/index.ts` named export only | `Modal` convenience wrapper for bounded confirm/cancel flows，`danger` 默认警告图标 + 破坏性确认按钮 |
| EmptyState | 1 | `src/components/ui/index.ts` named export only | bounded centered empty-state shell，支持 `title / description / icon / action` slot，legacy 兼容类由 caller 组合 |
| ProgressBar | 1 | `src/components/ui/index.ts` named export only | bounded linear progress shell，`success / warning / error / info / neutral`，需要时可叠加 `session-progress*` 兼容类 |
| Sheet | 2 | `src/components/ui/index.ts` named export only | bounded shared mobile bottom-sheet shell，保留 `.mobile-sheet*` 兼容 DOM/class，当前不含 portal、desktop drawer、组合式子组件 API |
| Select | 2 | `src/components/ui/index.ts` named export only | controlled single-value selector with desktop listbox + mobile sheet，保留 `.input` 与 `.mobile-select-trigger*` 兼容类 |
| SegmentedControl | 1 | `src/components/ui/index.ts` named export only | option-driven compact selector built on shared `Tabs` semantics，保留 settings segmented selector 兼容类 |
| Tabs | 1 | `src/components/ui/index.ts` named export only | controlled `Tabs / TabList / Tab / TabPanel` shell for bounded content switching，保留 `panel-*` / `worktree-*` 兼容类 |
| Toast | 1 | `src/components/ui/index.ts` named export only | `Toast` + `ToastViewport` presentational primitives，保留 legacy `toast*` 兼容类，队列/计时/导航留在 feature 层 |
| Tooltip | 1 | `src/components/ui/index.ts` named export only | bounded desktop/fine-pointer text tooltip；mobile/coarse pointers 为 no-op wrapper，当前不含 delay、placement variants、arrow 或 rich content |
| Pill | 0 | `src/components/ui/index.ts` named export only | `active / disabled / leadingIcon`，保留 legacy `settings-pill*` 兼容类 |
| Spinner | 0 | `src/components/ui/index.ts` named export only | `sm / md / lg`，`label` 必填，保留 legacy `animate-spin` 兼容类 |
| StatusDot | 0 | `src/components/ui/index.ts` named export only | `tone / size / pulse`，可叠加 legacy dot class |
| Switch | 0 | `src/components/ui/index.ts` named export only | `checked / onCheckedChange / disabled / size`，保留 legacy `settings-toggle` 兼容类 |
| Tag | 0 | `src/components/ui/index.ts` named export only | `color / size / caps`，保留 legacy `badge / badge-*` 兼容类 |
| Textarea | 0 | `src/components/ui/index.ts` named export only | `md / lg`，支持可选 `autoResize`，保留 legacy `input textarea` 兼容类 |

## 迁移状态
见 `./MIGRATION.md`。
