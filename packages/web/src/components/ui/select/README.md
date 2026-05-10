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
| `onValueChange` | `(value: T) => void` | `undefined` | Used by native and interactive modes |
| `desktopMode` | `"native" \| "listbox"` | `"native"` | `listbox` enables the bounded interactive trigger/listbox + mobile-sheet path |
| `mobileSheetTitle` | `string` | `undefined` | Required for the bounded interactive `desktopMode="listbox"` path |
| `mobileSheetPresentation` | `"sheet" \| "inline"` | `"sheet"` | Interactive mobile-sheet presentation |
| `mobile` | `boolean` | `false` | Bounded external trigger-only mobile mode |
| `onOpen` | `() => void` | `undefined` | Required for the external trigger-only mobile mode |
| `includeValueInAriaLabel` | `boolean` | `true` | External mobile mode only; affects `aria-label` callers only, set `false` to keep a fixed `aria-label` |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Reuses input sizing |
| `htmlSize` | `number` | `undefined` | Passes through the native `<select size>` attribute without colliding with visual sizing |
| `invalid` | `boolean` | `undefined` | Convenience `aria-invalid` styling |

## Notes
- This slice now covers the supervisor evaluator-provider selector family on desktop and mobile, plus the bounded mobile fullscreen terminal switcher trigger.
- The shared primitive is single-select only; `multiple` is intentionally not exposed.
- Default desktop mode remains a native `<select>` with legacy `.input` compatibility classes.
- The bounded interactive `desktopMode="listbox"` path renders a shared trigger + desktop `listbox`, and reuses `MobileSelectSheet` internally on mobile.
- The explicit `mobile` prop remains available for richer caller-owned mobile sheets such as the terminal switcher.
- `aria-labelledby` trigger callers still include the current value in the accessible name so labeled form controls announce the selection.
