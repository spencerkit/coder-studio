// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import type { FileContextMenuSection } from "../../actions/use-file-context-actions";
import { FileContextMenu } from "./file-context-menu";

function renderWithEnglishLocale(node: ReactNode) {
  const store = createStore();
  store.set(localeAtom, "en");

  return render(<Provider store={store}>{node}</Provider>);
}

function createSections(): FileContextMenuSection[] {
  return [
    {
      id: "create",
      title: "Create",
      items: [
        {
          id: "new-file",
          label: "New File",
          onSelect: vi.fn(),
        },
        {
          id: "new-folder",
          label: "New Folder",
          onSelect: vi.fn(),
        },
      ],
    },
    {
      id: "edit",
      title: "Edit",
      items: [
        {
          id: "rename",
          label: "Rename",
          onSelect: vi.fn(),
        },
        {
          id: "delete",
          label: "Delete",
          tone: "danger",
          onSelect: vi.fn(),
        },
      ],
    },
    {
      id: "path",
      title: "Path",
      items: [
        {
          id: "copy-relative-path",
          label: "Copy Relative Path",
          onSelect: vi.fn(),
        },
        {
          id: "copy-absolute-path",
          label: "Copy Absolute Path",
          disabled: true,
          onSelect: vi.fn(),
        },
      ],
    },
  ];
}

function DesktopMenuHarness({
  onClose,
  restoreFocusTo,
  sections,
}: {
  onClose: () => void;
  restoreFocusTo: HTMLElement;
  sections: FileContextMenuSection[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <FileContextMenu
      title="File actions"
      open={open}
      mode="desktop"
      anchorPoint={{ x: 120, y: 80 }}
      sections={sections}
      restoreFocusTo={restoreFocusTo}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileContextMenu", () => {
  it("renders a desktop menu with menu semantics, keyboard navigation, and focus restoration", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "README.md";
    document.body.appendChild(trigger);
    trigger.focus();
    const focusSpy = vi.spyOn(trigger, "focus");

    const sections = createSections();
    const renameAction = vi.mocked(sections[1]!.items[0]!.onSelect);
    const { unmount } = renderWithEnglishLocale(
      <DesktopMenuHarness onClose={onClose} restoreFocusTo={trigger} sections={sections} />
    );

    const menu = screen.getByRole("menu", { name: "File actions" });
    expect(document.body).toContainElement(menu);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await waitFor(() => {
      expect(menu).toHaveAttribute(
        "aria-activedescendant",
        "file-context-menu-item-create-new-file"
      );
      expect(screen.getByRole("menuitem", { name: "New File" })).toHaveAttribute(
        "data-active",
        "true"
      );
    });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await waitFor(() => {
      expect(menu).toHaveAttribute(
        "aria-activedescendant",
        "file-context-menu-item-create-new-folder"
      );
    });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await waitFor(() => {
      expect(menu).toHaveAttribute("aria-activedescendant", "file-context-menu-item-edit-rename");
    });

    fireEvent.keyDown(menu, { key: " " });
    await waitFor(() => {
      expect(renameAction).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });
    unmount();

    renderWithEnglishLocale(
      <DesktopMenuHarness onClose={onClose} restoreFocusTo={trigger} sections={sections} />
    );

    fireEvent.keyDown(screen.getByRole("menu", { name: "File actions" }), { key: "Escape" });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(focusSpy).toHaveBeenCalledTimes(2);
    });

    trigger.remove();
  });

  it("renders grouped actions in a mobile sheet", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const sections = createSections();

    renderWithEnglishLocale(
      <FileContextMenu
        title="File actions"
        open
        mode="mobile"
        sections={sections}
        onClose={onClose}
      />
    );

    const sheet = screen.getByRole("region", { name: "File actions sheet" });
    expect(sheet).toBeInTheDocument();

    expect(within(sheet).getByRole("heading", { name: "Create" })).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: "Edit" })).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: "Path" })).toBeInTheDocument();

    expect(within(sheet).getByRole("button", { name: "New File" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Copy Absolute Path" })).toBeDisabled();

    await user.click(within(sheet).getByRole("button", { name: "Delete" }));
    expect(vi.mocked(sections[1]!.items[1]!.onSelect)).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
