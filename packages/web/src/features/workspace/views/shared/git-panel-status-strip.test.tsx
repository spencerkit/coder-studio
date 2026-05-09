import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitPanelStatusStrip } from "./git-panel-status-strip";

vi.mock("../../../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => "desktop" as const,
}));

vi.mock("./git-status-bar", () => ({
  GitStatusBar: () => <div data-testid="git-status-bar" />,
}));

describe("GitPanelStatusStrip", () => {
  it("uses Tooltip instead of a native title attribute for the branch trigger", () => {
    const { container } = render(
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
    );

    const branchButton = container.querySelector(".git-panel-status-strip__branch");
    expect(branchButton).not.toBeNull();
    expect(branchButton).not.toHaveAttribute("title");

    fireEvent.mouseEnter(branchButton!);

    expect(screen.getByRole("tooltip")).toHaveTextContent("feature/tooltip-migration");
  });
});
