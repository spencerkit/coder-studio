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
});
