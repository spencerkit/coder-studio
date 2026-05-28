import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { activeFilePathAtomFamily } from "../../../workspace/atoms";
import { EditorPaneCard } from "./editor-pane-card";

vi.mock("../../../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: () => <div data-testid="editor-host">Editor Host</div>,
}));

describe("EditorPaneCard", () => {
  it("renders editor pane actions and delegates split and close callbacks", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    store.set(localeAtom, "en");
    store.set(activeFilePathAtomFamily("ws-123"), "src/app.tsx");

    render(
      <Provider store={store}>
        <EditorPaneCard
          workspaceId="ws-123"
          paneId="pane-1"
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
        />
      </Provider>
    );

    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getByTestId("editor-host")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Split horizontal" }));
    fireEvent.click(screen.getByRole("button", { name: "Split vertical" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onSplitPane).toHaveBeenNthCalledWith(1, "pane-1", "horizontal");
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "pane-1", "vertical");
    expect(onClosePane).toHaveBeenCalledWith("pane-1");
  });
});
