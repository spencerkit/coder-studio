# Badge

Shared count badge primitive for compact unread-style counters.

## Notes
- Count-only in this slice: `count <= 0` returns `null`, `count > max` displays `${max}+`.
- Current bounded caller: topbar workspace unread count.
