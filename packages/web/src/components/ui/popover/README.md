# Popover

Shared anchored floating layer for bounded custom-content dropdowns. The primitive is controlled via
`open` / `onOpenChange`, renders a portaled desktop `dialog`, and falls back to the shared `Sheet`
chrome on mobile unless `forceMode="desktop"` is explicitly requested.

## Usage

```tsx
const [open, setOpen] = useState(false);

<Popover
  content={<div>Custom content</div>}
  onOpenChange={setOpen}
  open={open}
  title="Quick Actions"
>
  <button type="button">Open</button>
</Popover>;
```

## Notes
- Desktop mode is click-to-toggle, outside-press dismiss, and Escape dismiss.
- Mobile mode reuses the shared `Sheet` primitive; keep the popover body self-contained.
- `placement="bottom-end"` is available for right-aligned toolbar triggers such as the terminal selector.
