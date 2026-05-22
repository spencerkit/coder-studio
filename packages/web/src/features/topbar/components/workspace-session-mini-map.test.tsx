import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSessionMiniMap } from "./workspace-session-mini-map";

describe("WorkspaceSessionMiniMap", () => {
  it("renders one decorative region per pane with state-specific classes and bounds", () => {
    const { container } = render(
      <WorkspaceSessionMiniMap
        cells={[
          {
            paneId: "left",
            sessionId: "sess-1",
            state: "running",
            x: 0,
            y: 0,
            width: 0.5,
            height: 1,
          },
          {
            paneId: "right",
            sessionId: null,
            state: "empty",
            x: 0.5,
            y: 0,
            width: 0.5,
            height: 1,
          },
        ]}
      />
    );

    expect(screen.getByTestId("workspace-session-mini-map")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".workspace-session-mini-map__cell")).toHaveLength(2);
    expect(container.querySelector(".workspace-session-mini-map__cell--running")).toHaveStyle({
      left: "0%",
      top: "0%",
      width: "50%",
      height: "100%",
    });
    expect(container.querySelector(".workspace-session-mini-map__cell--empty")).not.toBeNull();
  });

  it("does not expose interactive roles", () => {
    render(
      <WorkspaceSessionMiniMap
        cells={[
          {
            paneId: "root",
            sessionId: "sess-1",
            state: "idle",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        ]}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
