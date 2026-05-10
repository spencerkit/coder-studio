import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { ActionMenu, type ActionMenuForceMode } from "..";

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

function ActionMenuFixture({
  forceMode = "auto",
  title = "More actions",
}: {
  forceMode?: ActionMenuForceMode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  return (
    <div>
      <ActionMenu
        forceMode={forceMode}
        items={[
          {
            id: "settings",
            label: "Settings",
            onSelect: () => {
              setSelectedLabel("Settings");
            },
          },
          {
            id: "delete",
            label: "Delete",
            onSelect: () => {
              setSelectedLabel("Delete");
            },
            tone: "danger",
          },
        ]}
        onOpenChange={setOpen}
        open={open}
        title={title}
      >
        <button type="button">Open</button>
      </ActionMenu>
      <button type="button">Outside</button>
      {selectedLabel ? <div data-testid="action-menu-result">{selectedLabel}</div> : null}
    </div>
  );
}

describe("ActionMenu", () => {
  afterEach(() => {
    viewportMock.value = "desktop";
    vi.restoreAllMocks();
  });

  it("renders a desktop menu through document.body and dismisses on outside press and Escape", async () => {
    const user = userEvent.setup();

    renderWithLocale(<ActionMenuFixture />);

    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(document.body).toContainElement(menu);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("menu", { name: "More actions" })).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "More actions" })).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("supports desktop keyboard navigation and selection", async () => {
    renderWithLocale(<ActionMenuFixture />);

    const trigger = screen.getByRole("button", { name: "Open" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const settingsItem = await screen.findByRole("menuitem", { name: "Settings" });
    expect(settingsItem).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(settingsItem, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Delete" }), { key: "Enter" });

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "More actions" })).toBeNull();
    });
    expect(screen.getByTestId("action-menu-result")).toHaveTextContent("Delete");
  });

  it("opens from ArrowUp on the trigger and focuses the last enabled item", async () => {
    renderWithLocale(<ActionMenuFixture />);

    const trigger = screen.getByRole("button", { name: "Open" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    expect(await screen.findByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "tabindex",
      "0"
    );
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("tabindex", "-1");
  });

  it("renders the shared mobile sheet fallback and closes before item side effects land", async () => {
    const user = userEvent.setup();
    viewportMock.value = "mobile";

    renderWithLocale(<ActionMenuFixture />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("region", { name: "More actions sheet" })).toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "More actions" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "More actions sheet" })).toBeNull();
    });
    expect(screen.getByTestId("action-menu-result")).toHaveTextContent("Settings");
  });

  it("respects forceMode='desktop' even when the viewport is mobile", async () => {
    const user = userEvent.setup();
    viewportMock.value = "mobile";

    renderWithLocale(<ActionMenuFixture forceMode="desktop" title="Terminal actions" />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Terminal actions sheet" })).toBeNull();
  });
});
