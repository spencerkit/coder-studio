# Input

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Input type="password" placeholder="密码" />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 尺寸 |
| `htmlSize` | `number` | `undefined` | 原生 `input[size]` 属性，按字符宽度提示浏览器布局 |
| `invalid` | `boolean` | `undefined` | 添加错误态边框，并设置 `aria-invalid="true"` |
| `className` | `string` | `undefined` | 追加调用方类名 |

## 注意
- 当前只封装单行 `<input>`，不在这一轮引入 `prefix`、`suffix`、`clearable`。
- 迁移期保留 `.input` 和 `.input-sm/.input-lg` 兼容类。
- `size` 用于共享组件视觉尺寸；需要原生 `input[size]` 时请使用 `htmlSize`。
- 新代码不要再直接写原生 `className="input"`。
