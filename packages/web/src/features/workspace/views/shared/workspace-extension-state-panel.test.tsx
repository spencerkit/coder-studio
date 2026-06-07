// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { setWorkspaceExtensionStateAtom } from "../../atoms/extension-state";
import { WorkspaceExtensionStatePanel } from "./workspace-extension-state-panel";

const translations: Record<string, string> = {
  "workspace.extensions.title": "Extensions",
  "workspace.extensions.empty_title": "No extension state",
  "workspace.extensions.empty_body": "Status, progress, logs, and quick actions appear here.",
  "workspace.extensions.status_title": "Status",
  "workspace.extensions.progress_title": "Progress",
  "workspace.extensions.logs_title": "Logs",
  "workspace.extensions.quick_actions_title": "Quick Actions",
  "workspace.extensions.progress_value": "{{value}}/{{max}}",
  "workspace.extensions.action_failed": "Quick action failed",
};

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) => {
    const template = translations[key] ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => `${params?.[token] ?? ""}`);
  },
}));

function renderPanel() {
  const store = createStore();
  const sendCommand = vi.fn().mockResolvedValue(undefined);
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(setWorkspaceExtensionStateAtom, {
    workspaceId: "ws-1",
    statusPills: [
      {
        key: "ci",
        label: "CI running",
        state: "running",
        detail: "unit tests",
        updatedAt: 100,
      },
      {
        key: "lint",
        label: "Lint clean",
        state: "success",
        updatedAt: 101,
      },
    ],
    progress: [
      {
        key: "tests",
        label: "Tests",
        value: 6,
        max: 10,
        detail: "suite A",
        updatedAt: 102,
      },
    ],
    logs: [
      {
        key: "ci",
        level: "info",
        message: "Unit tests started",
        timestamp: 103,
      },
      {
        key: "ci",
        level: "warning",
        message: "Snapshot output changed",
        timestamp: 104,
      },
    ],
    quickActions: [
      {
        id: "rerun-tests",
        label: "Rerun tests",
        command: "extension.quickAction.run",
        description: "Run the current test command again",
      },
    ],
    updatedAt: 105,
  });

  render(
    <Provider store={store}>
      <WorkspaceExtensionStatePanel workspaceId="ws-1" />
    </Provider>
  );

  return { sendCommand };
}

describe("WorkspaceExtensionStatePanel", () => {
  it("renders status pills, progress, logs, and quick actions", () => {
    renderPanel();

    expect(screen.getByRole("heading", { level: 2, name: "Extensions" })).toBeInTheDocument();
    expect(screen.getByText("CI running")).toBeInTheDocument();
    expect(screen.getByText("unit tests")).toBeInTheDocument();
    expect(screen.getByText("Lint clean")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Tests" })).toHaveAttribute(
      "aria-valuenow",
      "6"
    );
    expect(screen.getByText("suite A")).toBeInTheDocument();
    expect(screen.getByText("Unit tests started")).toBeInTheDocument();
    expect(screen.getByText("Snapshot output changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rerun tests" })).toBeInTheDocument();
  });

  it("dispatches quick actions with workspace and action ids", () => {
    const { sendCommand } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Rerun tests" }));

    return waitFor(() => {
      expect(sendCommand.mock.calls[0]).toEqual([
        "extension.quickAction.run",
        {
          workspaceId: "ws-1",
          actionId: "rerun-tests",
        },
        undefined,
      ]);
    });
  });

  it("shows a compact empty state when no contributions are present", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <WorkspaceExtensionStatePanel workspaceId="ws-empty" />
      </Provider>
    );

    expect(screen.getByText("No extension state")).toBeInTheDocument();
    expect(
      screen.getByText("Status, progress, logs, and quick actions appear here.")
    ).toBeInTheDocument();
  });
});
