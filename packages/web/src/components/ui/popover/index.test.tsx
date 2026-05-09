import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { Popover, type PopoverForceMode } from "..";

const viewportMock = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

vi.mock("../_internal/use-viewport", () => ({
  useViewport: () => viewportMock.value,
}));

function renderWithLocale(node: ReactNode, locale: "en" | "zh" = "en") {
  const store = createStore();
  store.set(localeAtom, locale);

  return render(<Provider store={store}>{node}</Provider>);
}

function PopoverFixture({
  forceMode = "auto",
  title = "Quick Actions",
}: {
  forceMode?: PopoverForceMode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Popover
        content={<button type="button">Inspect Workspace</button>}
        forceMode={forceMode}
        onOpenChange={setOpen}
        open={open}
        title={title}
      >
        <button type="button">Open</button>
      </Popover>
      <button type="button">Outside</button>
    </div>
  );
}

describe("Popover", () => {
  afterEach(() => {
    viewportMock.value = "desktop";
    vi.restoreAllMocks();
  });

  it("renders a desktop popover through document.body and dismisses on outside press and Escape", async () => {
    const user = userEvent.setup();

    renderWithLocale(<PopoverFixture />);

    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Quick Actions" });
    expect(document.body).toContainElement(dialog);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(screen.getByRole("button", { name: "Inspect Workspace" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("dialog", { name: "Quick Actions" })).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Quick Actions" })).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the shared mobile sheet fallback on mobile viewports", async () => {
    const user = userEvent.setup();
    viewportMock.value = "mobile";

    renderWithLocale(<PopoverFixture />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("region", { name: "Quick Actions sheet" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Quick Actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByText("Inspect Workspace")).toBeInTheDocument();
  });

  it("respects forceMode='desktop' even when the viewport is mobile", async () => {
    const user = userEvent.setup();
    viewportMock.value = "mobile";

    renderWithLocale(<PopoverFixture forceMode="desktop" title="Terminal Sessions" />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("dialog", { name: "Terminal Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Terminal Sessions sheet" })).toBeNull();
  });
});
