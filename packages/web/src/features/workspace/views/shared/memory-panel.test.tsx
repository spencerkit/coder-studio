import type { WorkspaceMemoryEntry } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { MemoryPanel } from "./memory-panel";

const baseMemoryEntry: WorkspaceMemoryEntry = {
  id: "mem-1",
  workspaceId: "ws-1",
  type: "wiki",
  content: "Package scripts should run through pnpm.",
  source: { kind: "user" },
  createdAt: 1000,
  updatedAt: 2000,
};

const issueMemoryEntry: WorkspaceMemoryEntry = {
  ...baseMemoryEntry,
  id: "mem-2",
  type: "issue",
  content: "Dropdown stays open.",
  status: "pending_verification",
};

function renderMemoryPanel(
  sendCommand: ReturnType<typeof vi.fn>,
  options: { refreshToken?: number } = {}
) {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  return render(
    <Provider store={store}>
      <MemoryPanel workspaceId="ws-1" refreshToken={options.refreshToken ?? 0} />
    </Provider>
  );
}

describe("MemoryPanel", () => {
  it("renders the list-only memory panel layout without the selected-memory detail section", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "memory.list") {
        return [
          baseMemoryEntry,
          issueMemoryEntry,
          {
            ...baseMemoryEntry,
            id: "mem-3",
            type: "note",
            content: "Run targeted tests before handoff.",
          },
        ];
      }

      return null;
    });

    renderMemoryPanel(sendCommand);

    expect(await screen.findByText("Project Memory")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText("3 active entries")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Memory type" }))
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["All", "Wiki", "Issue", "Todo", "Note"]);
    await screen.findByRole("button", { name: "Package scripts should run through pnpm. Wiki" });
    expect(sendCommand).toHaveBeenCalledWith("memory.list", { workspaceId: "ws-1" }, undefined);
    expect(screen.getByText("Package scripts should run through pnpm.")).toBeInTheDocument();
    expect(screen.getByText("Dropdown stays open.")).toBeInTheDocument();
    expect(screen.getByText("wiki")).toBeInTheDocument();
    expect(screen.getByText("issue")).toBeInTheDocument();
    expect(screen.getByText("note")).toBeInTheDocument();
    expect(screen.getByText("pending verification")).toBeInTheDocument();
    expect(screen.queryByText("not started")).toBeNull();
    expect(screen.queryByText("Selected Memory")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save memory" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), {
      target: { value: "targeted tests" },
    });

    expect(
      screen.getByRole("button", { name: "Run targeted tests before handoff. Note" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Package scripts should run through pnpm. Wiki" })
    ).toBeNull();
    expect(sendCommand.mock.calls.filter(([op]) => op === "memory.list")).toHaveLength(1);
  });

  it("renders actionable memory statuses as separate status badges", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "memory.list") {
        return [issueMemoryEntry];
      }

      return null;
    });

    const { container } = renderMemoryPanel(sendCommand);

    await screen.findByRole("button", { name: "Dropdown stays open. Issue" });

    const badges = container.querySelector(".memory-panel__item-badges");
    expect(badges).not.toBeNull();

    const typeBadge = screen.getByText("issue");
    const statusBadge = screen.getByText("pending verification");

    expect(typeBadge).toHaveClass("memory-panel__badge", "memory-panel__badge--issue");
    expect(statusBadge).toHaveClass(
      "memory-panel__badge",
      "memory-panel__badge--status",
      "memory-panel__badge--status-pending_verification"
    );
  });

  it("creates and deletes memory entries without issuing inline update commands", async () => {
    let entries: WorkspaceMemoryEntry[] = [baseMemoryEntry];
    const sendCommand = vi.fn(async (op: string, args: unknown) => {
      if (op === "memory.list") {
        return entries;
      }

      if (op === "memory.create") {
        entries = [
          {
            ...baseMemoryEntry,
            ...(args as Partial<WorkspaceMemoryEntry>),
            id: "mem-2",
            source: { kind: "user" },
            createdAt: 3000,
            updatedAt: 3000,
          },
          ...entries,
        ];
        return entries[0];
      }

      if (op === "memory.delete") {
        const { id } = args as { id: string };
        const deleted = entries.find((entry) => entry.id === id);
        entries = entries.filter((entry) => entry.id !== id);
        return deleted;
      }

      return null;
    });

    renderMemoryPanel(sendCommand);

    await screen.findByRole("button", { name: "Package scripts should run through pnpm. Wiki" });
    expect(screen.queryByRole("button", { name: "Save memory" })).toBeNull();
    expect(screen.queryByText("Selected Memory")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New memory" }));

    const createDialog = await screen.findByRole("dialog", { name: "Create memory" });
    fireEvent.change(within(createDialog).getByLabelText("Content"), {
      target: { value: "Dropdown stays open." },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Type Wiki" }));
    fireEvent.click(
      within(within(createDialog).getByRole("listbox", { name: "Type" })).getByRole("option", {
        name: "Issue",
      })
    );
    fireEvent.click(within(createDialog).getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "memory.create",
        {
          workspaceId: "ws-1",
          type: "issue",
          content: "Dropdown stays open.",
          status: "not_started",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create memory" })).toBeNull();
    });

    expect(
      await screen.findByRole("button", {
        name: "Dropdown stays open. Issue",
      })
    ).toBeInTheDocument();
    expect(sendCommand.mock.calls.some(([op]) => op === "memory.update")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Delete memory Dropdown stays open\./i,
      })
    );

    const deleteDialog = await screen.findByRole("dialog", { name: "Delete memory?" });
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete memory" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "memory.delete",
        { workspaceId: "ws-1", id: "mem-2" },
        undefined
      );
    });
  });

  it("closes the create-memory type dropdown after selecting a category", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "memory.list") {
        return [baseMemoryEntry];
      }

      return null;
    });

    renderMemoryPanel(sendCommand);

    await screen.findByRole("button", { name: "Package scripts should run through pnpm. Wiki" });

    await user.click(screen.getByRole("button", { name: "New memory" }));

    const createDialog = await screen.findByRole("dialog", { name: "Create memory" });
    const typeTrigger = within(createDialog).getByRole("button", { name: "Type Wiki" });
    expect(within(createDialog).queryByRole("button", { name: /Status/i })).toBeNull();

    await user.click(typeTrigger);

    const listbox = within(createDialog).getByRole("listbox", { name: "Type" });
    await user.click(within(listbox).getByRole("option", { name: "Issue" }));

    expect(within(createDialog).queryByRole("listbox", { name: "Type" })).toBeNull();
    expect(within(createDialog).getByRole("button", { name: "Type Issue" })).toBeInTheDocument();
    expect(
      within(createDialog).getByRole("button", { name: "Status Not started" })
    ).toBeInTheDocument();

    await user.click(within(createDialog).getByRole("button", { name: "Type Issue" }));
    await user.click(
      within(within(createDialog).getByRole("listbox", { name: "Type" })).getByRole("option", {
        name: "Note",
      })
    );

    expect(within(createDialog).getByRole("button", { name: "Type Note" })).toBeInTheDocument();
    expect(within(createDialog).queryByRole("button", { name: /Status/i })).toBeNull();

    await user.click(within(createDialog).getByRole("button", { name: "Type Note" }));
    await user.click(
      within(within(createDialog).getByRole("listbox", { name: "Type" })).getByRole("option", {
        name: "Wiki",
      })
    );

    expect(within(createDialog).getByRole("button", { name: "Type Wiki" })).toBeInTheDocument();
    expect(within(createDialog).queryByRole("button", { name: /Status/i })).toBeNull();
  });

  it("edits issue memory status", async () => {
    let entries: WorkspaceMemoryEntry[] = [issueMemoryEntry];
    const sendCommand = vi.fn(async (op: string, args: unknown) => {
      if (op === "memory.list") {
        return entries;
      }

      if (op === "memory.update") {
        const { id, ...updates } = args as Partial<WorkspaceMemoryEntry> & { id: string };
        entries = entries.map((entry) =>
          entry.id === id ? { ...entry, ...updates, updatedAt: 4000 } : entry
        );
        return entries.find((entry) => entry.id === id);
      }

      return null;
    });

    renderMemoryPanel(sendCommand);

    await screen.findByRole("button", { name: "Dropdown stays open. Issue" });
    fireEvent.click(screen.getByRole("button", { name: /Edit memory Dropdown stays open\./i }));

    const editDialog = await screen.findByRole("dialog", { name: "Edit memory" });
    expect(
      within(editDialog).getByRole("button", { name: "Status Pending verification" })
    ).toBeInTheDocument();

    fireEvent.click(
      within(editDialog).getByRole("button", { name: "Status Pending verification" })
    );
    fireEvent.click(
      within(within(editDialog).getByRole("listbox", { name: "Status" })).getByRole("option", {
        name: "Completed",
      })
    );
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "memory.update",
        {
          workspaceId: "ws-1",
          id: "mem-2",
          type: "issue",
          content: "Dropdown stays open.",
          status: "completed",
        },
        undefined
      );
    });
  });

  it("keeps the list visible while showing the correct delete dialog title", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "memory.list") {
        return [baseMemoryEntry];
      }

      return null;
    });

    renderMemoryPanel(sendCommand);

    expect(
      await screen.findByRole("button", {
        name: "Package scripts should run through pnpm. Wiki",
      })
    ).toBeInTheDocument();
    expect(screen.queryByText("Selected Memory")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Delete memory Package scripts should run through pnpm\./i,
      })
    );

    const deleteDialog = await screen.findByRole("dialog", { name: "Delete memory?" });
    expect(screen.getByRole("list", { name: "Memory entries" })).toBeInTheDocument();
    expect(
      within(deleteDialog).getByText(/Package scripts should run through pnpm\./i)
    ).toBeInTheDocument();
  });

  it("shows command failures as a panel notice", async () => {
    const sendCommand = vi.fn(async () => {
      throw new Error("memory storage unavailable");
    });

    renderMemoryPanel(sendCommand);

    expect(await screen.findByText("memory storage unavailable")).toBeInTheDocument();
  });
});
