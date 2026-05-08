# Switch

Shared button-based switch primitive for binary settings toggles.

## Usage

```tsx
<Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
<Switch checked={soundEnabled} disabled={!notificationsEnabled} size="sm" />
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `checked` | `boolean` | required | 受控开关状态 |
| `onCheckedChange` | `(checked: boolean) => void` | required | 点击后返回下一个状态 |
| `disabled` | `boolean` | `false` | 禁用交互 |
| `size` | `"sm" \| "md"` | `"md"` | 开关尺寸 |
| `className` | `string` | `undefined` | 允许叠加业务兼容 class |

## Notes
- 使用 `button` + `role="switch"` + `aria-checked`，不依赖隐藏 checkbox markup。
- 当前 bounded callers：`SettingsPage` 通知开关。
