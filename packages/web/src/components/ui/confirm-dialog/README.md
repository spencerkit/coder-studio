# ConfirmDialog

## Usage
Import from the public barrel at `src/components/ui/index.ts`:

```tsx
<ConfirmDialog
  open
  onOpenChange={setOpen}
  title="Delete file"
  description="This action cannot be undone."
  cancelText="Cancel"
  confirmText="Delete"
  tone="danger"
  onConfirm={handleDelete}
/>
```

## Props
| Prop | Type | Default | Notes |
|---|---|---|---|
| `open` | `boolean` | required | Controls visibility |
| `onOpenChange` | `(open: boolean) => void` | required | Called for close requests |
| `title` | `ReactNode` | required | Header title |
| `description` | `ReactNode` | `undefined` | Body content; supports rich copy |
| `cancelText` | `ReactNode` | required | Cancel button label |
| `confirmText` | `ReactNode` | required | Confirm button label |
| `onConfirm` | `() => void` | required | Confirm action |
| `tone` | `"default" \| "danger"` | `"default"` | Maps confirm styling; `danger` adds warning icon |
| `dismissible` | `boolean` | `true` | Disables overlay / Escape / close button when false |
| `closeLabel` | `string` | `"Close"` | Accessible label for the close affordance |
| `confirmDisabled` | `boolean` | `false` | Disables the confirm button |
| `confirmButtonProps` | `ButtonProps` subset | `undefined` | Passes through non-variant confirm button props |
| `className` | `string` | `undefined` | Applied to the modal shell |
| `initialFocus` | `ModalProps["initialFocus"]` | `undefined` | Passed through to `Modal` |

## Notes
- Built on the shared `Modal`, `Button`, and `IconButton` primitives.
- Keeps legacy compatibility classes through those underlying shared components.
- Intended for bounded confirm/cancel flows; forms and richer layouts should stay on raw `Modal`.
