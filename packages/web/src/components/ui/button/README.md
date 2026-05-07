# Button

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Button variant="primary" size="md">保存</Button>
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "ghost" \| "danger"` | `"secondary"` | 视觉变体 |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 尺寸 |
| `loading` | `boolean` | `false` | 显示 spinner，并禁用 button 点击 |
| `leadingIcon` | `ReactNode` | `undefined` | 文本前图标 |
| `trailingIcon` | `ReactNode` | `undefined` | 文本后图标 |
| `as` | `"button" \| "a"` | `"button"` | 渲染元素 |

## 注意
- `danger` 只用于破坏性操作。
- `loading` 只会对原生 `<button>` 强制 `disabled`；对于 `<a>`，只会加 `aria-busy`。
- 新代码不要再写 `btn btn-*`。
