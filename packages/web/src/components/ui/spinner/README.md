# Spinner

## Usage
共享 loading spinner primitive：

```tsx
<Spinner label="Loading directories" />
<Spinner label="Syncing workspace" size="lg" />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `label` | `string` | required | 可访问性文案，作为 `aria-label` |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | spinner 尺寸 |
| `className` | `string` | `undefined` | 业务附加 class，会和 legacy `animate-spin` 并存 |

## Notes
- 组件默认保留 `animate-spin` 兼容类。
- 适合独立 loading 指示器；button 内 loading 继续优先复用 Button 自带 spinner。
