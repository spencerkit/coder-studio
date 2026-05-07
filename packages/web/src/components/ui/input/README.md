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
| `invalid` | `boolean` | `false` | 添加错误态边框，并设置 `aria-invalid="true"` |
| `className` | `string` | `undefined` | 业务附加 class，迁移期会和 legacy `input` 并存 |

## 注意
- 当前只封装最小 parity API，不在这一轮引入 `prefix`、`suffix`、`clearable`。
- 新代码不要再直接写原生 `className="input"`。
