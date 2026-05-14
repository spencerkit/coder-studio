import type { GitStatus } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider, useSetAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { toastsAtom } from "../../../notifications/atoms";
import { branchQuickPickAtom, gitBranchListAtomFamily } from "../../atoms";
import { BranchQuickPick, DesktopBranchQuickPickPopover } from "./branch-quick-pick";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));
const activeElementState = {
  current: null as HTMLElement | null,
};
const originalFocus = HTMLElement.prototype.focus;

vi.mock("../../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

function DesktopQuickPickHarness({ workspaceId = "ws-test" }: { workspaceId?: string }) {
  const setQuickPick = useSetAtom(branchQuickPickAtom);

  return (
    <DesktopBranchQuickPickPopover
      workspaceId={workspaceId}
      onOpenBranchSwitcher={() =>
        setQuickPick({
          visible: true,
          workspaceId,
          inputValue: "",
        })
      }
    >
      <button type="button">Branches</button>
    </DesktopBranchQuickPickPopover>
  );
}

describe("BranchQuickPick", () => {
  let store: ReturnType<typeof createStore>;
  let sendCommandMock: ReturnType<typeof vi.fn>;

  const gitStatus: GitStatus = {
    branch: "main",
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
  };

  beforeEach(() => {
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

    store = createStore();
    store.set(localeAtom, "en");
    sendCommandMock = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.checkout") {
        return {
          success: true,
          message: "ok",
        };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "feature/auth", isCurrent: false, isRemote: false },
            { name: "feature/ui", isCurrent: false, isRemote: false },
            { name: "origin/develop", isCurrent: false, isRemote: true },
          ],
        };
      }

      if (op === "git.status") {
        return gitStatus;
      }

      return undefined;
    });

    // Mock WebSocket client with sendCommand method
    store.set(wsClientAtom, {
      sendCommand: sendCommandMock,
    } as never);
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: "ws-test",
      inputValue: "",
    });
    store.set(gitBranchListAtomFamily("ws-test"), {
      current: "main",
      branches: [
        { name: "main", isCurrent: true, isRemote: false },
        { name: "feature/auth", isCurrent: false, isRemote: false },
        { name: "feature/ui", isCurrent: false, isRemote: false },
        { name: "origin/develop", isCurrent: false, isRemote: true },
      ],
      loading: false,
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: originalFocus,
    });
    delete (document as Document & { activeElement?: Element }).activeElement;
    vi.restoreAllMocks();
    viewportMocks.viewport = "desktop";
  });

  const renderQuickPick = () =>
    render(
      <Provider store={store}>
        {viewportMocks.viewport === "mobile" ? <BranchQuickPick /> : <DesktopQuickPickHarness />}
      </Provider>
    );

  it("filters branches by input text", async () => {
    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");
    expect(input).toBeInTheDocument();

    // Initially shows all branches
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.getByText("feature/ui")).toBeInTheDocument();
    expect(screen.getByText("origin/develop")).toBeInTheDocument();

    // Filter by "feature"
    fireEvent.change(input, { target: { value: "feature" } });

    await waitFor(() => {
      expect(screen.getByText("feature/auth")).toBeInTheDocument();
      expect(screen.getByText("feature/ui")).toBeInTheDocument();
      expect(screen.queryByText("main")).not.toBeInTheDocument();
      expect(screen.queryByText("origin/develop")).not.toBeInTheDocument();
    });
  });

  it("renders the shared MobileSelectSheet shell for branch quick pick", () => {
    viewportMocks.viewport = "mobile";

    renderQuickPick();

    expect(screen.getByRole("region", { name: "Branch sheet" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search branches or create new branch...")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "main" })).toHaveAttribute("aria-pressed", "true");
  });

  it("highlights the real current branch when the mobile picker opens", () => {
    viewportMocks.viewport = "mobile";
    store.set(gitBranchListAtomFamily("ws-test"), {
      current: "feature/ui",
      branches: [
        { name: "feature/auth", isCurrent: false, isRemote: false },
        { name: "feature/ui", isCurrent: true, isRemote: false },
        { name: "main", isCurrent: false, isRemote: false },
      ],
      loading: false,
    });

    renderQuickPick();

    expect(screen.getByRole("button", { name: "feature/ui" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "feature/auth" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "feature/ui" })).toHaveAccessibleDescription(
      "Current Branch"
    );
    expect(screen.getByText("Current Branch")).toBeInTheDocument();
  });

  it("hides branches that are already checked out in another worktree on mobile", () => {
    viewportMocks.viewport = "mobile";
    store.set(gitBranchListAtomFamily("ws-test"), {
      current: "develop",
      branches: [
        {
          name: "chore/e2e-specs-reorg",
          isCurrent: false,
          isRemote: false,
          linkedWorktreePath: "/tmp/e2e-specs-reorg",
        },
        { name: "develop", isCurrent: true, isRemote: false },
      ],
      loading: false,
    });

    renderQuickPick();

    expect(screen.queryByRole("button", { name: "chore/e2e-specs-reorg" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "develop" })).toBeInTheDocument();
  });

  it("does not keep the current branch selected when mobile focus moves to create branch", async () => {
    viewportMocks.viewport = "mobile";
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: "ws-test",
      inputValue: "m",
    });

    renderQuickPick();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create branch" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Create branch" })).toHaveAccessibleDescription("m");

    fireEvent.keyDown(screen.getByPlaceholderText("Search branches or create new branch..."), {
      key: "ArrowDown",
    });

    expect(screen.getByRole("button", { name: "main" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders localized copy for the mobile branch quick pick", () => {
    viewportMocks.viewport = "mobile";
    store.set(localeAtom, "zh");

    renderQuickPick();

    expect(screen.getByRole("region", { name: "分支面板" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索分支或创建新分支...")).toBeInTheDocument();
  });

  it("renders the remote branch label with shared tag compatibility classes", () => {
    renderQuickPick();

    expect(screen.getByText("Remote")).toHaveClass(
      "badge",
      "badge-gray",
      "branch-quick-pick-badge"
    );
  });

  it("shows create option for non-existent branch", async () => {
    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    // Type a non-existent branch name
    fireEvent.change(input, { target: { value: "new-feature" } });

    await waitFor(() => {
      expect(screen.getByText("Create branch: new-feature")).toBeInTheDocument();
    });
    expect(
      screen
        .getByText("Create branch: new-feature")
        .closest(".branch-quick-pick-item")
        ?.querySelector('[data-icon-semantic="git.branch.create"]')
    ).toBeTruthy();

    // Should not show create option for existing branch
    fireEvent.change(input, { target: { value: "main" } });

    await waitFor(() => {
      expect(screen.queryByText("Create branch: main")).not.toBeInTheDocument();
    });
  });

  it("checks out branch on Enter key", async () => {
    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    // Select a branch by typing part of its name
    fireEvent.change(input, { target: { value: "auth" } });

    await waitFor(() => {
      expect(screen.getByText("feature/auth")).toBeInTheDocument();
    });

    // Press Enter to checkout
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.checkout",
        {
          workspaceId: "ws-test",
          ref: "feature/auth",
        },
        undefined
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.branches",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.status",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    // Should close after successful checkout
    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it("shows an error toast and keeps the picker open when checkout fails", async () => {
    viewportMocks.viewport = "mobile";
    sendCommandMock.mockImplementation(async (op: string) => {
      if (op === "git.checkout") {
        return {
          success: false,
          message: "Branch is already used by another worktree",
        };
      }

      if (op === "git.branches") {
        return {
          current: "main",
          branches: [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "feature/auth", isCurrent: false, isRemote: false },
          ],
        };
      }

      if (op === "git.status") {
        return gitStatus;
      }

      return undefined;
    });

    renderQuickPick();

    fireEvent.click(screen.getByRole("button", { name: "feature/auth" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "error",
            body: "Branch is already used by another worktree",
          }),
        ])
      );
    });
    expect(store.get(branchQuickPickAtom).visible).toBe(true);
  });

  it("requires confirmation before creating a new branch on Enter", async () => {
    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    fireEvent.change(input, { target: { value: "new-branch" } });

    await waitFor(() => {
      expect(screen.getByText("Create branch: new-branch")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(sendCommandMock).not.toHaveBeenCalledWith(
      "git.checkout",
      {
        workspaceId: "ws-test",
        ref: "new-branch",
        createBranch: true,
      },
      undefined
    );
    expect(screen.getByText("Confirm create branch: new-branch")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.checkout",
        {
          workspaceId: "ws-test",
          ref: "new-branch",
          createBranch: true,
        },
        undefined
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.branches",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.status",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it("keeps the mobile keyboard target on confirm create after tapping create with mixed results", async () => {
    const user = userEvent.setup();
    viewportMocks.viewport = "mobile";
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: "ws-test",
      inputValue: "m",
    });

    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    await user.click(screen.getByRole("button", { name: "Create branch" }));

    expect(screen.getByRole("button", { name: "Confirm create branch" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm create branch" })
    ).toHaveAccessibleDescription("m");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.checkout",
        {
          workspaceId: "ws-test",
          ref: "m",
          createBranch: true,
        },
        undefined
      );
    });

    expect(sendCommandMock).not.toHaveBeenCalledWith(
      "git.checkout",
      {
        workspaceId: "ws-test",
        ref: "main",
      },
      undefined
    );
  });

  it("navigates with arrow keys", async () => {
    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    // First branch is selected by default
    const firstItem = screen.getByText("main").closest(".branch-quick-pick-item");
    expect(firstItem).toHaveClass("branch-quick-pick-item-selected");

    // Press ArrowDown to select next branch
    fireEvent.keyDown(input, { key: "ArrowDown" });

    await waitFor(() => {
      const secondItem = screen.getByText("feature/auth").closest(".branch-quick-pick-item");
      expect(secondItem).toHaveClass("branch-quick-pick-item-selected");
      expect(firstItem).not.toHaveClass("branch-quick-pick-item-selected");
    });

    // Press ArrowUp to go back
    fireEvent.keyDown(input, { key: "ArrowUp" });

    await waitFor(() => {
      expect(firstItem).toHaveClass("branch-quick-pick-item-selected");
    });
  });

  it("closes on Escape key", async () => {
    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    fireEvent.keyDown(input, { key: "Escape" });

    // Wait for state update using act
    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it("closes when clicking outside the desktop popover", async () => {
    renderQuickPick();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it("shows loading state while branches are loading", () => {
    store.set(gitBranchListAtomFamily("ws-test"), {
      current: "",
      branches: [],
      loading: true,
    });

    renderQuickPick();

    const emptyStateTitle = screen.getByText("Loading branches...");

    expect(emptyStateTitle.tagName).toBe("P");
    expect(emptyStateTitle.closest(".branch-quick-pick-empty")).toBeTruthy();
  });

  it("shows the shared idle empty state when there are no branches yet", async () => {
    sendCommandMock.mockImplementation(async (op: string) => {
      if (op === "git.branches") {
        return {
          current: "",
          branches: [],
        };
      }

      if (op === "git.status") {
        return gitStatus;
      }

      return undefined;
    });
    store.set(gitBranchListAtomFamily("ws-test"), {
      current: "",
      branches: [],
      loading: false,
    });

    renderQuickPick();

    const emptyStateTitle = await screen.findByText("Type to search branches");

    expect(emptyStateTitle.tagName).toBe("P");
    expect(emptyStateTitle.closest(".branch-quick-pick-empty")).toBeTruthy();
  });

  it("shows the shared filtered empty state when the search has no display items", async () => {
    sendCommandMock.mockImplementation(async (op: string) => {
      if (op === "git.branches") {
        return {
          current: "",
          branches: [],
        };
      }

      if (op === "git.status") {
        return gitStatus;
      }

      return undefined;
    });
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: "ws-test",
      inputValue: "   ",
    });
    store.set(gitBranchListAtomFamily("ws-test"), {
      current: "",
      branches: [],
      loading: false,
    });

    renderQuickPick();

    const emptyStateTitle = await screen.findByText("No branches found");

    expect(emptyStateTitle.tagName).toBe("P");
    expect(emptyStateTitle.closest(".branch-quick-pick-empty")).toBeTruthy();
  });

  it("shows all branches when input is empty", async () => {
    renderQuickPick();

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.getByText("feature/ui")).toBeInTheDocument();
    expect(screen.getByText("origin/develop")).toBeInTheDocument();
  });

  it("shows current branch indicator", () => {
    renderQuickPick();

    // The current branch should have a check icon
    const mainBranchItem = screen.getByText("main").closest(".branch-quick-pick-item");
    expect(mainBranchItem).toBeInTheDocument();
    // Check icon is rendered within the selected item
    expect(mainBranchItem?.querySelector(".branch-quick-pick-check")).toBeTruthy();
  });

  it("shows remote badge for remote branches", () => {
    renderQuickPick();

    // Remote branch should show "Remote" badge
    const remoteBranchItem = screen.getByText("origin/develop").closest(".branch-quick-pick-item");
    expect(remoteBranchItem).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
  });

  it("does not render when not visible", () => {
    store.set(branchQuickPickAtom, {
      visible: false,
      inputValue: "",
    });

    renderQuickPick();

    expect(
      screen.queryByPlaceholderText("Search branches or create new branch...")
    ).not.toBeInTheDocument();
  });

  it("handles checkout failure gracefully", async () => {
    sendCommandMock.mockRejectedValueOnce(new Error("Checkout failed"));

    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    fireEvent.change(input, { target: { value: "feature/auth" } });

    await waitFor(() => {
      expect(screen.getByText("feature/auth")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.checkout",
        {
          workspaceId: "ws-test",
          ref: "feature/auth",
        },
        undefined
      );
    });

    // Should remain open on failure
    expect(store.get(branchQuickPickAtom).visible).toBe(true);
  });

  it("keeps quick pick open when git.checkout returns success false in payload", async () => {
    sendCommandMock.mockImplementationOnce(async (op: string) => {
      if (op === "git.checkout") {
        return {
          success: false,
          message: "Checkout blocked by local changes",
        };
      }

      return undefined;
    });

    renderQuickPick();

    const input = screen.getByPlaceholderText("Search branches or create new branch...");

    fireEvent.change(input, { target: { value: "feature/auth" } });

    await waitFor(() => {
      expect(screen.getByText("feature/auth")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        "git.checkout",
        {
          workspaceId: "ws-test",
          ref: "feature/auth",
        },
        undefined
      );
    });

    expect(store.get(branchQuickPickAtom).visible).toBe(true);
  });

  it("opens the desktop popover from the trigger and autofocuses the input", async () => {
    store.set(branchQuickPickAtom, {
      visible: false,
      workspaceId: "ws-test",
      inputValue: "",
    });

    renderQuickPick();

    fireEvent.click(screen.getByRole("button", { name: "Branches" }));

    const input = await screen.findByPlaceholderText("Search branches or create new branch...");
    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "ws-test",
      inputValue: "",
    });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });

  it("closes the desktop popover when the trigger is clicked again", async () => {
    store.set(branchQuickPickAtom, {
      visible: false,
      workspaceId: "ws-test",
      inputValue: "",
    });

    renderQuickPick();

    const trigger = screen.getByRole("button", { name: "Branches" });
    fireEvent.click(trigger);
    await screen.findByPlaceholderText("Search branches or create new branch...");

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
    expect(
      screen.queryByPlaceholderText("Search branches or create new branch...")
    ).not.toBeInTheDocument();
  });
});
