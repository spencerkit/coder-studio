import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { branchQuickPickAtom, gitBranchListAtomFamily } from "../../atoms";
import { BranchPickerButton } from "./branch-picker-button";

const viewportMocks = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => viewportMocks.value,
}));

function renderWithEnglish(ui: React.ReactElement, store = createStore()) {
  store.set(localeAtom, "en");
  return {
    store,
    ...render(<Provider store={store}>{ui}</Provider>),
  };
}

describe("BranchPickerButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    viewportMocks.value = "desktop";
  });

  it("displays current branch name", () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "main",
      branches: [],
      loading: false,
    });

    renderWithEnglish(<BranchPickerButton workspaceId="test-workspace" />, store);

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Current Branch: main. Switch Branch" })
    ).toBeInTheDocument();
  });

  it('shows "Not on any branch" when detached HEAD', () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "",
      branches: [],
      loading: false,
    });

    renderWithEnglish(<BranchPickerButton workspaceId="test-workspace" />, store);

    expect(screen.getByText("Not on any branch")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Not on any branch. Switch Branch" })
    ).toBeInTheDocument();
  });

  it("opens Quick Pick when clicked", () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "main",
      branches: [],
      loading: false,
    });

    renderWithEnglish(<BranchPickerButton workspaceId="test-workspace" />, store);

    fireEvent.click(screen.getByRole("button", { name: "Current Branch: main. Switch Branch" }));

    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "test-workspace",
      inputValue: "",
    });
  });

  it("uses the shared tooltip instead of a native title on the trigger", () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "main",
      branches: [],
      loading: false,
    });

    renderWithEnglish(<BranchPickerButton workspaceId="test-workspace" />, store);

    const trigger = screen.getByRole("button", { name: "Current Branch: main. Switch Branch" });
    expect(trigger).not.toHaveAttribute("title");

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Switch Branch");
  });

  it("renders the branch semantic icon in the trigger", () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "main",
      branches: [],
      loading: false,
    });

    const { container } = renderWithEnglish(
      <BranchPickerButton workspaceId="test-workspace" />,
      store
    );

    expect(container.querySelector('[data-icon-semantic="git.branch"]')).toBeTruthy();
  });
});
