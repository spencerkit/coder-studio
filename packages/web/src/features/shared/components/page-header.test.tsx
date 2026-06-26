import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("keeps the back button and title grouped on the left while actions stay on the right", () => {
    render(
      <PageHeader
        title="Agent Sessions"
        backLabel="Back"
        onBack={vi.fn()}
        rightSlot={<button type="button">Edit</button>}
      />
    );

    const header = document.querySelector(".page-header");
    const leading = header?.querySelector(".page-header__leading");
    const actions = header?.querySelector(".page-header__actions");

    expect(header).toHaveClass("page-header--secondary");
    expect(header).toHaveAttribute("data-level", "secondary");
    expect(leading).not.toBeNull();
    expect(actions).not.toBeNull();
    const backButton = within(leading as HTMLElement).getByRole("button", { name: "Back" });
    expect(backButton).toBeInTheDocument();
    expect(within(backButton).queryByText("Back")).toBeNull();
    expect(within(leading as HTMLElement).getByText("Agent Sessions")).toBeInTheDocument();
    expect(
      within(actions as HTMLElement).getByRole("button", { name: "Edit" })
    ).toBeInTheDocument();
  });

  it("renders the optional kicker above the left-aligned title copy", () => {
    render(<PageHeader title="Config" kicker="Workspace" backLabel="Back" onBack={vi.fn()} />);

    const copy = document.querySelector(".page-header__copy");

    expect(copy).not.toBeNull();
    expect(within(copy as HTMLElement).getByText("Workspace")).toBeInTheDocument();
    expect(within(copy as HTMLElement).getByText("Config")).toBeInTheDocument();
    expect(screen.queryByText("Back")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders stable primary level hooks for shared styling", () => {
    render(<PageHeader title="Workspace Settings" level="primary" />);

    const header = document.querySelector(".page-header");

    expect(header).toHaveClass("page-header--primary");
    expect(header).toHaveAttribute("data-level", "primary");
    expect(header).not.toHaveClass("page-header--secondary");
  });
});
