import type { WorkspaceMemoryEntry } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { MemoryPanel } from "./memory-panel";

const baseMemoryEntry: WorkspaceMemoryEntry = {
  id: "mem-1",
  workspaceId: "ws-1",
  type: "project",
  content: "Package scripts should run through pnpm.",
  source: { kind: "user" },
  createdAt: 1000,
  updatedAt: 2000,
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
          {
            ...baseMemoryEntry,
            id: "mem-2",
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
    expect(screen.getByText("2 active entries")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Note" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Package scripts should run through pnpm. Project" });
    expect(sendCommand).toHaveBeenCalledWith("memory.list", { workspaceId: "ws-1" }, undefined);
    expect(screen.getByText("Package scripts should run through pnpm.")).toBeInTheDocument();
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("note")).toBeInTheDocument();
    expect(screen.queryByText("Selected Memory")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save memory" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), {
      target: { value: "targeted tests" },
    });

    expect(
      screen.getByRole("button", { name: "Run targeted tests before handoff. Note" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Package scripts should run through pnpm. Project" })
    ).toBeNull();
    expect(sendCommand.mock.calls.filter(([op]) => op === "memory.list")).toHaveLength(1);
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

    await screen.findByRole("button", { name: "Package scripts should run through pnpm. Project" });
    expect(screen.queryByRole("button", { name: "Save memory" })).toBeNull();
    expect(screen.queryByText("Selected Memory")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New memory" }));

    const createDialog = await screen.findByRole("dialog", { name: "Create memory" });
    fireEvent.change(within(createDialog).getByLabelText("Content"), {
      target: { value: "Workspace memory is stored per workspace." },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "memory.create",
        {
          workspaceId: "ws-1",
          type: "project",
          content: "Workspace memory is stored per workspace.",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create memory" })).toBeNull();
    });

    expect(
      await screen.findByRole("button", {
        name: "Workspace memory is stored per workspace. Project",
      })
    ).toBeInTheDocument();
    expect(sendCommand.mock.calls.some(([op]) => op === "memory.update")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Delete memory Workspace memory is stored per workspace\./i,
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
        name: "Package scripts should run through pnpm. Project",
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
