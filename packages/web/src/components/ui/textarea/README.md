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
| `invalid` | `boolean` | `undefined` | 添加错误态边框，并设置 `aria-invalid="true"` |
| `autoResize` | `boolean` | `false` | 按内容同步高度 |
| `className` | `string` | `undefined` | 追加调用方类名 |

## 注意
- 迁移期保留 `input` 和 `textarea` 兼容类。
- 共享 primitive 自己提供 textarea 的高度与 resize 行为，不依赖旧的全局 `textarea.input` 规则兜底。
- 当前默认仍保留 `resize: vertical`，避免改变现有桌面端交互。
- 布局和上下文细节继续由调用方类名控制，例如 `settings-provider-args-input`。
- 新代码不要再直接写原生 `className="input textarea"`。
