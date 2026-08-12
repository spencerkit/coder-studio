import type { BrowserWindow, ContextMenuParams, Menu, MenuItemConstructorOptions } from "electron";

type DesktopContextMenuParams = Pick<ContextMenuParams, "editFlags" | "isEditable">;
type DesktopMenuFactory = Pick<typeof Menu, "buildFromTemplate">;

function buildEditableTemplate(
  editFlags: ContextMenuParams["editFlags"]
): MenuItemConstructorOptions[] {
  return [
    { role: "undo", enabled: editFlags.canUndo },
    { role: "redo", enabled: editFlags.canRedo },
    { type: "separator" },
    { role: "cut", enabled: editFlags.canCut },
    { role: "copy", enabled: editFlags.canCopy },
    { role: "paste", enabled: editFlags.canPaste },
    { role: "delete", enabled: editFlags.canDelete },
    { type: "separator" },
    { role: "selectAll", enabled: editFlags.canSelectAll },
  ];
}

export function buildDesktopContextMenuTemplate(
  params: DesktopContextMenuParams
): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    return buildEditableTemplate(params.editFlags);
  }

  const template: MenuItemConstructorOptions[] = [];
  if (params.editFlags.canCopy) {
    template.push({ role: "copy" });
  }
  if (params.editFlags.canSelectAll) {
    template.push({ role: "selectAll" });
  }
  return template;
}

export function installDesktopContextMenu(
  window: BrowserWindow,
  menuFactory: DesktopMenuFactory
): void {
  window.webContents.on("context-menu", (_event, params) => {
    const template = buildDesktopContextMenuTemplate(params);
    if (template.length === 0) return;

    menuFactory.buildFromTemplate(template).popup({ window });
  });
}
