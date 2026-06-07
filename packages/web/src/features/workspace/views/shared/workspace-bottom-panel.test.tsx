import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { WorkspaceBottomPanel } from "./workspace-bottom-panel";

vi.mock("../../../terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

describe("WorkspaceBottomPanel", () => {
  it("renders the terminal directly without a separate tasks tab", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <WorkspaceBottomPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Tasks" })).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});
