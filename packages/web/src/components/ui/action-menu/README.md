# ActionMenu

Shared action-list menu for bounded overflow and more-actions triggers. Desktop renders an anchored
`menu`; mobile falls back to the shared `Sheet` chrome with the same item model.

## Usage

```tsx
const [open, setOpen] = useState(false);

<ActionMenu
  items={[
    {
      id: "settings",
      label: "Settings",
      onSelect: () => navigate("/settings"),
    },
  ]}
  onOpenChange={setOpen}
  open={open}
  title="More actions"
>
  <button type="button">Open</button>
</ActionMenu>;
```

## Notes
- Use `open` / `onOpenChange` so callers can coordinate menu dismissal with follow-up UI.
- `tone="danger"` is available for destructive actions.
- Mobile item selection closes the menu before running item side effects to avoid nested sheet
  stacks.
