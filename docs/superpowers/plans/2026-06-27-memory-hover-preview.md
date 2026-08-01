# Memory Hover Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop hover preview for truncated memory list content so users can read full memory text without opening the edit dialog.

**Architecture:** Reuse the shared bounded `Tooltip` primitive already used across `packages/web` instead of introducing a new overlay. Keep the existing two-line truncated list preview, and only attach a tooltip when the normalized full content differs from the visible preview so short entries do not render unnecessary hover UI.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, shared `Tooltip` UI primitive

---

### Task 1: Add regression coverage for memory hover preview

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
  it("shows a tooltip with the full memory content when hovering a truncated entry", async () => {
    const longEntry = {
      ...baseMemoryEntry,
      id: "mem-long",
      content:
        "This memory entry is intentionally long so the list preview truncates it, while the hover tooltip still reveals the full normalized content for quick reading.",
    };
    const shortEntry = {
      ...baseMemoryEntry,
      id: "mem-short",
      content: "Short memory.",
    };
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "memory.list") {
        return [longEntry, shortEntry];
      }

      return null;
    });

    renderMemoryPanel(sendCommand);

    const truncatedPreview = await screen.findByText(
      "This memory entry is intentionally long so the list preview truncates it, while the hover tooltip still reveals the ful..."
    );

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(truncatedPreview);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(longEntry.content);
    expect(truncatedPreview).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");

    fireEvent.mouseLeave(truncatedPreview);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(screen.getByText("Short memory."));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --run packages/web/src/features/workspace/views/shared/memory-panel.test.tsx -t "shows a tooltip with the full memory content when hovering a truncated entry"`
Expected: FAIL because the memory content preview is not wrapped in `Tooltip`, so no `role="tooltip"` element appears.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/features/workspace/views/shared/memory-panel.test.tsx
git commit -m "test(web): cover memory hover preview"
```

### Task 2: Implement truncated-memory hover tooltip

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/memory-panel.tsx`
- Test: `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`

- [ ] **Step 1: Write minimal implementation**

```tsx
import { Button, ConfirmDialog, IconButton, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, Select, Tooltip, type SelectOption } from "../../../../components/ui";

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/gu, " ");
}

function previewContent(content: string): string {
  const normalized = normalizeMemoryContent(content);
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function shouldShowMemoryPreviewTooltip(content: string): boolean {
  const normalized = normalizeMemoryContent(content);
  return normalized.length > 120;
}

const preview = previewContent(entry.content);
const contentNode = <span className="memory-panel__item-content">{preview}</span>;

{shouldShowMemoryPreviewTooltip(entry.content) ? (
  <Tooltip content={normalizeMemoryContent(entry.content)}>{contentNode}</Tooltip>
) : (
  contentNode
)}
```

- [ ] **Step 2: Run focused test to verify it passes**

Run: `pnpm --filter web test -- --run packages/web/src/features/workspace/views/shared/memory-panel.test.tsx -t "shows a tooltip with the full memory content when hovering a truncated entry"`
Expected: PASS and the tooltip contains the full memory content only for the truncated entry.

- [ ] **Step 3: Run the full memory panel test file**

Run: `pnpm --filter web test -- --run packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`
Expected: PASS with all `MemoryPanel` tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/features/workspace/views/shared/memory-panel.tsx packages/web/src/features/workspace/views/shared/memory-panel.test.tsx
git commit -m "feat(web): show full memory content on hover"
```
