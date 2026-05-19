import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelHeader } from "./panel-header";

describe("PanelHeader", () => {
  it("keeps title and meta grouped on the left while actions stay on the right", () => {
    render(
      <PanelHeader
        title="Session"
        meta={<span>Claude</span>}
        actions={<button type="button">Close</button>}
      />
    );

    const header = document.querySelector(".panel-header");
    const leading = header?.querySelector(".panel-header__leading");
    const actions = header?.querySelector(".panel-header__actions");

    expect(header).not.toBeNull();
    expect(leading).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(within(leading as HTMLElement).getByText("Session")).toBeInTheDocument();
    expect(within(leading as HTMLElement).getByText("Claude")).toBeInTheDocument();
    expect(
      within(actions as HTMLElement).getByRole("button", { name: "Close" })
    ).toBeInTheDocument();
  });

  it("renders status inline with the title copy without requiring bespoke modifiers", () => {
    render(<PanelHeader title="Git" status={<span>Modified</span>} meta={<span>2 files</span>} />);

    const header = document.querySelector(".panel-header");
    const copy = header?.querySelector(".panel-header__copy");
    const status = header?.querySelector(".panel-header__status");

    expect(header).toHaveClass("panel-header");
    expect(copy).not.toBeNull();
    expect(status).not.toBeNull();
    expect(within(copy as HTMLElement).getByText("Git")).toBeInTheDocument();
    expect(within(copy as HTMLElement).getByText("2 files")).toBeInTheDocument();
    expect(within(status as HTMLElement).getByText("Modified")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("can render meta inline inside the title row when requested", () => {
    render(
      <PanelHeader
        title="SESSION-20"
        meta={<span>Codex</span>}
        status={<span>Online</span>}
        metaPlacement="inline"
      />
    );

    const header = document.querySelector(".panel-header");
    const titleRow = header?.querySelector(".panel-header__title-row");
    const inlineMeta = header?.querySelector(".panel-header__meta--inline");

    expect(header).toHaveClass("panel-header", "panel-header--inline-meta");
    expect(titleRow).not.toBeNull();
    expect(inlineMeta).not.toBeNull();
    expect(titleRow).toContainElement(screen.getByText("SESSION-20"));
    expect(titleRow).toContainElement(screen.getByText("Codex"));
    expect(titleRow).toContainElement(inlineMeta as HTMLElement);
  });

  it("supports additional class names on the root header", () => {
    render(<PanelHeader title="Session" className="session-header--running" />);

    const header = document.querySelector(".panel-header");

    expect(header).toHaveClass("panel-header", "session-header--running");
  });
});
