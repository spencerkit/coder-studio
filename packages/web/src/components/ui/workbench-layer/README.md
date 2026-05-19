# WorkbenchLayer

Shared governed desktop global command-surface shell for command palette, launcher, and future
workspace-level quick-switch flows. It portals to `document.body`, traps focus, locks document
scroll while open, and owns the shared backdrop so feature code only supplies surface content.
