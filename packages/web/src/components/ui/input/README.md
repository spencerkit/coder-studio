# Input

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Input aria-label="Workspace name" placeholder="demo-app" />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 视觉尺寸 variant |
| `htmlSize` | `number` | `undefined` | 原生 `input[size]` 属性，按字符宽度提示浏览器布局 |
| `invalid` | `boolean` | `undefined` | 便捷设置 `aria-invalid` 和错误态样式 |
| `className` | `string` | `undefined` | 追加调用方类名 |

## 注意
- 这是单行 `<input>` 包装，不包含 `textarea` 或 `select` 语义。
- 迁移期保留 `.input` 和 `.input-sm/.input-lg` 兼容类。
- `size` 用于共享组件视觉尺寸；需要原生 `input[size]` 时请使用 `htmlSize`。
- 新代码优先通过该组件复用共享样式，再按需叠加调用方类名。
