import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSessionMiniMap } from "./workspace-session-mini-map";

describe("WorkspaceSessionMiniMap", () => {
  it("renders one decorative square per cell with a state-specific class", () => {
    const { container } = render(
      <WorkspaceSessionMiniMap
        cells={[
          { paneId: "left", sessionId: "sess-1", state: "running", x: 0.25, y: 0.5 },
          { paneId: "right", sessionId: null, state: "empty", x: 0.75, y: 0.5 },
        ]}
      />
    );

    expect(screen.getByTestId("workspace-session-mini-map")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".workspace-session-mini-map__cell")).toHaveLength(2);
    expect(container.querySelector(".workspace-session-mini-map__cell--running")).not.toBeNull();
    expect(container.querySelector(".workspace-session-mini-map__cell--empty")).not.toBeNull();
  });

  it("does not expose interactive roles", () => {
    render(
      <WorkspaceSessionMiniMap
        cells={[{ paneId: "root", sessionId: "sess-1", state: "idle", x: 0.5, y: 0.5 }]}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
