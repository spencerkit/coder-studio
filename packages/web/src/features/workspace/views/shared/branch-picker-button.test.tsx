import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { branchQuickPickAtom, gitBranchListAtomFamily } from "../../atoms";
import { BranchPickerButton } from "./branch-picker-button";

describe("BranchPickerButton", () => {
  it("displays current branch name", () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "main",
      branches: [],
      loading: false,
    });

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it('shows "No branch" when detached HEAD', () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "",
      branches: [],
      loading: false,
    });

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    expect(screen.getByText("No branch")).toBeInTheDocument();
  });

  it("opens Quick Pick when clicked", () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily("test-workspace"), {
      current: "main",
      branches: [],
      loading: false,
    });

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button"));

    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "test-workspace",
      inputValue: "",
    });
  });
});
