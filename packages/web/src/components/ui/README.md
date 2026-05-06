# Coder Studio UI

## 总则
- 已落地的基础组件统一从 public barrel（当前文件路径为 `src/components/ui/index.ts`）引入，不允许深链到组件子路径。
- 所有颜色、间距、字号、圆角、阴影、动效必须来自 `src/styles/tokens.css`。
- 业务代码禁止新增 `btn btn-*`、`input` 这类旧式全局 className；未迁移的遗留调用点只允许原样保留，不允许扩散。
- PC / 移动差异默认由 token 或共享内部逻辑解决，业务代码不直接写 `matchMedia`。

## 已实现组件
当前 phase 只会先落 `Button`。公共导出完成后，这里会改成可用组件列表。

## 迁移状态
见 `./MIGRATION.md`。
