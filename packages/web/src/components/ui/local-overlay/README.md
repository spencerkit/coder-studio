# LocalOverlay

Shared governed host-scoped runtime overlay for terminal, editor, and panel-local blocking or
status surfaces. It stays inside the host flow, never portals or locks document scroll, defaults to
pass-through status behavior, and only allows backdrop dismissal for explicitly interactive dialog
states.
