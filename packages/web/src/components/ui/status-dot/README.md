# StatusDot

## Usage
共享状态圆点 primitive，按 tone / size / pulse 组合使用：

```tsx
<StatusDot tone="success" />
<StatusDot tone="warning" pulse />
<StatusDot
  tone="info"
  className="session-dot session-dot-running"
/>
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `tone` | `"success" \| "warning" \| "error" \| "info" \| "neutral"` | `"neutral"` | 状态颜色 |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 圆点尺寸 |
| `pulse` | `boolean` | `false` | 启用脉冲动画 |
| `className` | `string` | `undefined` | 追加 feature-specific 或 legacy 兼容 class |

## Notes
- 已迁移调用点可继续追加 `session-dot*` / `connection-status-dot*` 兼容类。
- 默认 `aria-hidden="true"`，适合纯装饰状态点。
