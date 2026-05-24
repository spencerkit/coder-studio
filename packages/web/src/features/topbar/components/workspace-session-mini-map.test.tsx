import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSessionMiniMap } from "./workspace-session-mini-map";

describe("WorkspaceSessionMiniMap", () => {
  it("renders one decorative column per measured pane column", () => {
    const { container } = render(
      <WorkspaceSessionMiniMap
        columns={2}
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
    expect(screen.getByTestId("workspace-session-mini-map")).toHaveStyle({
      "--workspace-session-map-columns": "2",
    });
    expect(container.querySelector(".workspace-session-mini-map__viewport")).not.toBeNull();
    const columns = container.querySelectorAll(".workspace-session-mini-map__column");

    expect(columns).toHaveLength(2);
    expect(columns[0]?.getAttribute("style")).toContain(
      "linear-gradient(180deg, var(--workspace-session-map-running) 0%, var(--workspace-session-map-running) 100%)"
    );
    expect(columns[1]?.getAttribute("style")).toContain(
      "linear-gradient(180deg, var(--workspace-session-map-empty) 0%, var(--workspace-session-map-empty) 100%)"
    );
  });

  it("compresses stacked panes in one column into a single gradient fill", () => {
    const { container } = render(
      <WorkspaceSessionMiniMap
        columns={1}
        cells={[
          {
            paneId: "top",
            sessionId: "sess-1",
            state: "starting",
            x: 0,
            y: 0,
            width: 1,
            height: 0.25,
          },
          {
            paneId: "middle",
            sessionId: null,
            state: "empty",
            x: 0,
            y: 0.25,
            width: 1,
            height: 0.25,
          },
          {
            paneId: "bottom",
            sessionId: "sess-2",
            state: "idle",
            x: 0,
            y: 0.5,
            width: 1,
            height: 0.5,
          },
        ]}
      />
    );

    expect(container.querySelectorAll(".workspace-session-mini-map__column")).toHaveLength(1);
    expect(
      container.querySelector(".workspace-session-mini-map__column")?.getAttribute("style")
    ).toContain(
      "linear-gradient(180deg, var(--workspace-session-map-starting) 0%, var(--workspace-session-map-starting) 33.3%, var(--workspace-session-map-empty) 33.3%, var(--workspace-session-map-empty) 66.7%, var(--workspace-session-map-idle) 66.7%, var(--workspace-session-map-idle) 100%)"
    );
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
