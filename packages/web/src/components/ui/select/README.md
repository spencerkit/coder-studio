# Select

## Usage
Import from the public UI barrel:

```tsx
<Select
  aria-label="Evaluator"
  options={[
    { value: "claude", label: "Claude" },
    { value: "codex", label: "Codex" },
  ]}
  value="claude"
  onValueChange={(value) => setProvider(value)}
/>
```

## Props
| Prop | Type | Default | Notes |
|---|---|---|---|
| `options` | `ReadonlyArray<SelectOption<T>>` | — | Required for both modes |
| `value` | `T` | `undefined` | Controlled value |
| `onValueChange` | `(value: T) => void` | `undefined` | Native select mode |
| `mobile` | `boolean` | `false` | Switches to trigger-only mobile mode |
| `onOpen` | `() => void` | `undefined` | Required in mobile mode |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Reuses input sizing |
| `htmlSize` | `number` | `undefined` | Passes through the native `<select size>` attribute without colliding with visual sizing |
| `invalid` | `boolean` | `undefined` | Convenience `aria-invalid` styling |

## Notes
- This slice only covers the supervisor objective dialog evaluator-provider flow.
- The shared primitive is single-select only; `multiple` is intentionally not exposed.
- Desktop uses a native `<select>` with legacy `.input` compatibility classes.
- Mobile uses a trigger shell that reopens the existing `MobileSelectSheet` flow.
