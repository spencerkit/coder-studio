import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { branchQuickPickAtom, gitBranchListAtomFamily } from "../../atoms";
import { GitPanelStatusStrip } from "./git-panel-status-strip";

const activeElementState = {
  current: null as HTMLElement | null,
};
const originalFocus = HTMLElement.prototype.focus;

vi.mock("../../../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => "desktop" as const,
}));

vi.mock("../../../../hooks/use-viewport", () => ({
  useViewport: () => "desktop" as const,
}));

vi.mock("./git-status-bar", () => ({
  GitStatusBar: () => <div data-testid="git-status-bar" />,
}));

describe("GitPanelStatusStrip", () => {
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: originalFocus,
    });
    delete (document as Document & { activeElement?: Element }).activeElement;
  });

  it("uses Tooltip instead of a native title attribute for the branch trigger", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    const { container } = render(
      <Provider store={store}>
        <GitPanelStatusStrip
          workspaceId="ws-1"
          gitState={{
            branch: "feature/tooltip-migration",
            ahead: 2,
            behind: 1,
            staged: [],
            modified: [],
            deleted: [],
            untracked: [],
          }}
          onOpenBranchSwitcher={vi.fn()}
        />
      </Provider>
    );

    const branchButton = container.querySelector(".git-panel-status-strip__branch");
    expect(branchButton).not.toBeNull();
    expect(branchButton).not.toHaveAttribute("title");

    fireEvent.mouseEnter(branchButton!);

    expect(screen.getByRole("tooltip")).toHaveTextContent("feature/tooltip-migration");
  });

  it("opens the desktop branch quick pick from ArrowDown without changing the button semantics", async () => {
    activeElementState.current = document.body;
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => activeElementState.current,
    });
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: function focus() {
        activeElementState.current = this;
      },
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(branchQuickPickAtom, {
      visible: false,
      workspaceId: "ws-1",
      inputValue: "",
    });
    store.set(gitBranchListAtomFamily("ws-1"), {
      current: "feature/tooltip-migration",
      branches: [
        { name: "feature/tooltip-migration", isCurrent: true, isRemote: false },
        { name: "origin/main", isCurrent: false, isRemote: true },
      ],
      loading: false,
    });

    render(
      <Provider store={store}>
        <GitPanelStatusStrip
          workspaceId="ws-1"
          gitState={{
            branch: "feature/tooltip-migration",
            ahead: 2,
            behind: 1,
            staged: [],
            modified: [],
            deleted: [],
            untracked: [],
          }}
          onOpenBranchSwitcher={() =>
            store.set(branchQuickPickAtom, {
              visible: true,
              workspaceId: "ws-1",
              inputValue: "",
            })
          }
        />
      </Provider>
    );

    const branchButton = screen.getByRole("button", {
      name: "Current Branch: feature/tooltip-migration",
    });

    expect(branchButton).toHaveClass("git-panel-status-strip__branch");

    fireEvent.keyDown(branchButton, { key: "ArrowDown" });

    const input = await screen.findByPlaceholderText("Search branches or create new branch...");
    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "ws-1",
      inputValue: "",
    });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });
});
