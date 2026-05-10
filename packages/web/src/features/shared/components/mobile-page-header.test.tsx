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
    expect(leading).not.toBeNull();
    expect(within(leading as HTMLElement).getByText("Open Workspace")).toBeInTheDocument();
    expect(screen.queryByText("WORKSPACE")).not.toBeInTheDocument();
  });
});
