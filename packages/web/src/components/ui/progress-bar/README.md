# ProgressBar

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<ProgressBar max={100} tone="info" value={42} />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `value` | `number` | 必填 | 当前值，determinate 模式下会按 `0..max` clamp |
| `max` | `number` | 必填 | 最大值，`<= 0` 时按 `0` 处理 |
| `tone` | `"success" \| "warning" \| "error" \| "info" \| "neutral"` | 必填 | 语义色 |
| `indeterminate` | `boolean` | `false` | 不显示具体进度，只渲染运动中的 fill |
| `className` | `string` | `undefined` | 透传到根节点 |
| `fillClassName` | `string` | `undefined` | 透传到 fill 节点 |

## 注意
- 只负责 presentational shell；进度计算、状态映射、异步控制流留在 feature code。
- 默认输出 `progressbar` ARIA 语义；如果调用方只是装饰条，可通过透传 `aria-hidden` 关闭这些语义。
- 迁移期由调用方决定是否叠加 legacy 兼容类，例如 `session-progress*`。
