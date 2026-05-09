# Textarea

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Textarea aria-label="Objective" rows={5} placeholder="Describe the goal" />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `size` | `"md" \| "lg"` | `"md"` | 文本域尺寸 |
| `invalid` | `boolean` | `undefined` | 便捷设置 `aria-invalid` 和错误态样式 |
| `className` | `string` | `undefined` | 追加调用方类名 |

## 注意
- 迁移期保留 `input` 和 `textarea` 兼容类。
- 共享 primitive 自己提供 textarea 的高度与 resize 行为，不依赖旧的全局 `textarea.input` 规则兜底。
- 布局和上下文细节继续由调用方类名控制，例如 `settings-provider-args-input`。
- `git-panel` 的提交消息输入不属于 `.input.textarea` 迁移范围。
