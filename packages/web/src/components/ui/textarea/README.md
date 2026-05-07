# Textarea

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Textarea rows={5} placeholder="输入目标" />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `size` | `"md" \| "lg"` | `"md"` | 最小高度和字号 |
| `invalid` | `boolean` | `false` | 添加错误态边框，并设置 `aria-invalid="true"` |
| `autoResize` | `boolean` | `false` | 按内容同步高度 |
| `className` | `string` | `undefined` | 业务附加 class，迁移期会和 legacy `input textarea` 并存 |

## 注意
- 当前默认仍保留 `resize: vertical`，避免改变现有桌面端交互。
- 新代码不要再直接写原生 `className="input textarea"`。
