import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobilePageHeader } from "./mobile-page-header";

describe("MobilePageHeader", () => {
  it("keeps mobile headers to a single-line title treatment by hiding the optional kicker", () => {
    render(
      <MobilePageHeader
        title="Open Workspace"
        kicker="WORKSPACE"
        backLabel="Back"
        onBack={vi.fn()}
      />
    );

    const header = document.querySelector(".mobile-page-header");
    const leading = header?.querySelector(".page-header__leading");

    expect(header).not.toBeNull();
    expect(header).toHaveClass("page-header--secondary");
    expect(header).toHaveAttribute("data-level", "secondary");
    expect(leading).not.toBeNull();
    const backButton = within(leading as HTMLElement).getByRole("button", { name: "Back" });
    expect(backButton).toBeInTheDocument();
    expect(within(backButton).queryByText("Back")).toBeNull();
    expect(within(leading as HTMLElement).getByText("Open Workspace")).toBeInTheDocument();
    expect(screen.queryByText("WORKSPACE")).not.toBeInTheDocument();
  });

  it("passes the requested level through without showing the kicker by default", () => {
    render(<MobilePageHeader title="Launch Task" kicker="Agent" level="primary" />);

    const header = document.querySelector(".mobile-page-header");

    expect(header).toHaveClass("page-header--primary");
    expect(header).toHaveAttribute("data-level", "primary");
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });
});
