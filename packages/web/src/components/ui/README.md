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
| Kbd | 0 | `src/components/ui/index.ts` named export only | `sm / md`，保留 legacy `shortcuts-key` 兼容类 |
| Pill | 0 | `src/components/ui/index.ts` named export only | `active / disabled / leadingIcon`，保留 legacy `settings-pill*` 兼容类 |
| Spinner | 0 | `src/components/ui/index.ts` named export only | `sm / md / lg`，`label` 必填，保留 legacy `animate-spin` 兼容类 |
| StatusDot | 0 | `src/components/ui/index.ts` named export only | `tone / size / pulse`，可叠加 legacy dot class |
| Tag | 0 | `src/components/ui/index.ts` named export only | `color / size / caps`，保留 legacy `badge / badge-*` 兼容类 |
| Textarea | 0 | `src/components/ui/index.ts` named export only | `md / lg`，支持可选 `autoResize`，保留 legacy `input textarea` 兼容类 |

## 迁移状态
见 `./MIGRATION.md`。
