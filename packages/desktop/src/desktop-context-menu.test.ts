import type { BrowserWindow, ContextMenuParams, Menu } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopContextMenuTemplate,
  installDesktopContextMenu,
} from "./desktop-context-menu.js";

function createParams(
  overrides: Partial<Pick<ContextMenuParams, "editFlags" | "isEditable">> = {}
): Pick<ContextMenuParams, "editFlags" | "isEditable"> {
  return {
    isEditable: false,
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: false,
      canEditRichly: false,
    },
    ...overrides,
  };
}

describe("Desktop context menu", () => {
  it("builds a complete edit menu with renderer-provided enabled states", () => {
    const template = buildDesktopContextMenuTemplate(
      createParams({
        isEditable: true,
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: true,
          canPaste: false,
          canDelete: true,
          canSelectAll: true,
          canEditRichly: false,
        },
      })
    );

    expect(template).toEqual([
      { role: "undo", enabled: true },
      { role: "redo", enabled: false },
      { type: "separator" },
      { role: "cut", enabled: true },
      { role: "copy", enabled: true },
      { role: "paste", enabled: false },
      { role: "delete", enabled: true },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ]);
  });

  it("only exposes applicable actions for non-editable content", () => {
    const template = buildDesktopContextMenuTemplate(
      createParams({
        editFlags: {
          ...createParams().editFlags,
          canCopy: true,
          canSelectAll: true,
        },
      })
    );

    expect(template).toEqual([{ role: "copy" }, { role: "selectAll" }]);
    expect(buildDesktopContextMenuTemplate(createParams())).toEqual([]);
  });

  it("opens the native menu only when the context has an applicable action", () => {
    let contextMenuListener: ((event: unknown, params: ContextMenuParams) => void) | undefined;
    const window = {
      webContents: {
        on: vi.fn((eventName, listener) => {
          expect(eventName).toBe("context-menu");
          contextMenuListener = listener;
        }),
      },
    } as unknown as BrowserWindow;
    const popup = vi.fn();
    const buildFromTemplate = vi.fn(() => ({ popup }));

    installDesktopContextMenu(window, { buildFromTemplate } as unknown as Pick<
      typeof Menu,
      "buildFromTemplate"
    >);

    contextMenuListener?.({}, createParams() as ContextMenuParams);
    expect(buildFromTemplate).not.toHaveBeenCalled();

    const actionableParams = createParams({
      editFlags: { ...createParams().editFlags, canCopy: true },
    });
    contextMenuListener?.({}, actionableParams as ContextMenuParams);

    expect(buildFromTemplate).toHaveBeenCalledWith([{ role: "copy" }]);
    expect(popup).toHaveBeenCalledWith({ window });
  });
});
