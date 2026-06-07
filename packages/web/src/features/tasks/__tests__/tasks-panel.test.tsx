import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { bottomPanelActiveTabAtomFamily } from "../../bottom-panel";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../../terminal-panel/atoms";
import { TasksPanel } from "../views/shared/tasks-panel";

const verifyTask: TaskDefinition = {
  id: "verify",
  workspaceId: "ws-test",
  kind: "verify",
  label: "Verify",
  command: "pnpm",
  args: ["ci:verify"],
  displayCommand: "pnpm changeset:validate && pnpm ci:lint && pnpm ci:test && pnpm ci:build",
  cwdPath: ".",
  source: "package-json",
  priority: 900,
};

const runningRun: TaskRun = {
  id: "run-1",
  workspaceId: "ws-test",
  taskId: "verify",
  terminalId: "term-task",
  status: "running",
  command: "pnpm",
  args: ["ci:verify"],
  cwdPath: ".",
  startedAt: 100,
};

function renderPanel(options: { sendCommand?: ReturnType<typeof vi.fn>; wsClient?: unknown } = {}) {
  const store = createStore();
  const sendCommand =
    options.sendCommand ??
    vi.fn(async (op: string) => {
      if (op === "task.list") return [verifyTask];
      if (op === "task.history") return [];
      if (op === "task.run") return runningRun;
      return {};
    });
  store.set(localeAtom, "en");
  store.set(
    wsClientAtom,
    (options.wsClient ?? { sendCommand, subscribe: vi.fn(() => vi.fn()) }) as never
  );

  render(
    <Provider store={store}>
      <TasksPanel workspaceId="ws-test" />
    </Provider>
  );

  return { store, sendCommand };
}

describe("TasksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders discovered tasks with command previews", async () => {
    renderPanel();

    expect(await screen.findByText("Verify")).toBeInTheDocument();
    expect(
      screen.getByText("pnpm changeset:validate && pnpm ci:lint && pnpm ci:test && pnpm ci:build")
    ).toBeInTheDocument();
    expect(screen.getByText("Not run")).toBeInTheDocument();
  });

  it("runs a task and switches output to the terminal tab", async () => {
    const user = userEvent.setup();
    const { store, sendCommand } = renderPanel();

    await user.click(await screen.findByRole("button", { name: /run verify/i }));

    expect(sendCommand).toHaveBeenCalledWith(
      "task.run",
      expect.objectContaining({
        workspaceId: "ws-test",
        taskId: "verify",
      }),
      undefined
    );
    await waitFor(() => {
      expect(store.get(bottomPanelActiveTabAtomFamily("ws-test"))).toBe("terminal");
    });
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term-task");
    expect(store.get(terminalIdsAtomFamily("ws-test"))).toContain("term-task");
    expect(store.get(terminalMetaAtomFamily("term-task"))).toMatchObject({
      kind: "task",
      title: "Task: Verify",
    });
  });

  it("stops a running task", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "task.list") return [verifyTask];
      if (op === "task.history") return [runningRun];
      if (op === "task.stop") return { ...runningRun, status: "stopped", finishedAt: 200 };
      return {};
    });
    renderPanel({ sendCommand });

    await user.click(await screen.findByRole("button", { name: /stop verify/i }));

    expect(sendCommand).toHaveBeenCalledWith(
      "task.stop",
      {
        workspaceId: "ws-test",
        runId: "run-1",
      },
      undefined
    );
  });
});
