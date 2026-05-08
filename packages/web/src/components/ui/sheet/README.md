# Sheet

Bounded shared mobile bottom-sheet shell for the current first-phase callers. It preserves the
existing `.mobile-sheet*` DOM and class contract, keeps the inline `title/body/footer` API from the
feature-owned implementation, and intentionally does not introduce portal, focus-trap, desktop
drawer, or compositional sheet subcomponents in this phase.
