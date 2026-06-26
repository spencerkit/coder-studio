import { FileCode2, Globe, PanelsTopLeft, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../../../lib/i18n";
import type { OpenFile, WorkspaceEditorTab } from "../../../workspace/atoms";

interface CodeEditorTabsHeaderProps {
  activeFilePath: string | null;
  activeFullPath: string;
  activeEditorTab?: WorkspaceEditorTab | null;
  className?: string;
  dirtyStatusLabel?: ReactNode;
  emptyLabel?: string;
  onActivateEditorTab?: (tab: WorkspaceEditorTab) => void;
  onActivateOpenFile: (path: string) => void;
  onCloseAllEditorTabs?: () => void;
  onCloseEditorTab?: (tab: WorkspaceEditorTab) => void;
  onCloseEditorTabsToRight?: (tab: WorkspaceEditorTab) => void;
  onCloseOpenFilePath?: (path: string) => void;
  onCloseOtherEditorTabs?: (tab: WorkspaceEditorTab) => void;
  onCloseSavedEditorTabs?: () => void;
  onKeepOpenEditorTab?: (tab: WorkspaceEditorTab) => void;
  openEditorTabs?: WorkspaceEditorTab[];
  openEditorPaths: string[];
  openFiles: Record<string, OpenFile>;
  pathActions?: ReactNode;
  showPathRow?: boolean;
  tabbarActions?: ReactNode;
  workspaceRootPath?: string;
}

export function getFileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

export function getParentFolderName(path: string): string | null {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  return segments[segments.length - 2] ?? null;
}

export function getFileTypeLabel(path: string): string {
  const fileName = getFileName(path);
  const extension = fileName.includes(".") ? fileName.split(".").pop() : null;
  if (!extension) {
    return "FILE";
  }

  return extension.slice(0, 3).toUpperCase();
}

export function getFullWorkspaceFilePath(
  workspaceRootPath: string | undefined,
  path: string
): string {
  const normalizedPath = path.replace(/\\/g, "/");
  if (!workspaceRootPath || normalizedPath.startsWith("/") || normalizedPath.startsWith("~")) {
    return normalizedPath;
  }

  return `${workspaceRootPath.replace(/[\\/]+$/, "")}/${normalizedPath}`;
}

export function getPathBreadcrumbSegments(path: string): string[] {
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return normalizedPath.startsWith("/") ? ["/"] : [];
  }

  if (normalizedPath.startsWith("/")) {
    return [`/${segments[0]}`, ...segments.slice(1)];
  }

  return segments;
}

export function isDirtyFile(file: OpenFile | undefined): boolean {
  return file?.kind === "text" && file.isDirty === true;
}

function isSameEditorTab(left: WorkspaceEditorTab | null | undefined, right: WorkspaceEditorTab) {
  if (!left) {
    return false;
  }

  if (left.kind === "browser" && right.kind === "browser") {
    return left.id === right.id;
  }

  if (left.kind === "file" && right.kind === "file") {
    return left.path === right.path;
  }

  if (left.kind === "canvas" && right.kind === "canvas") {
    if (left.canvasId && right.canvasId) {
      return left.canvasId === right.canvasId;
    }

    return left.sourcePath === right.sourcePath;
  }

  return false;
}

interface TabContextMenuState {
  tab: WorkspaceEditorTab;
  x: number;
  y: number;
}

interface TabContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function CodeEditorTabsHeader({
  activeFilePath,
  activeFullPath,
  activeEditorTab,
  className,
  dirtyStatusLabel,
  emptyLabel,
  onActivateEditorTab,
  onActivateOpenFile,
  onCloseAllEditorTabs,
  onCloseEditorTab,
  onCloseEditorTabsToRight,
  onCloseOpenFilePath,
  onCloseOtherEditorTabs,
  onCloseSavedEditorTabs,
  onKeepOpenEditorTab,
  openEditorTabs,
  openEditorPaths,
  openFiles,
  pathActions,
  showPathRow = true,
  tabbarActions,
  workspaceRootPath,
}: CodeEditorTabsHeaderProps) {
  const t = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const visibleEditorTabs =
    openEditorTabs ?? openEditorPaths.map((path): WorkspaceEditorTab => ({ kind: "file", path }));
  const fileTabPaths = visibleEditorTabs.flatMap((tab) => (tab.kind === "file" ? [tab.path] : []));
  const fileNameCounts = fileTabPaths.reduce<Record<string, number>>((counts, path) => {
    const fileName = getFileName(path);
    counts[fileName] = (counts[fileName] ?? 0) + 1;
    return counts;
  }, {});
  const activeBreadcrumbSegments = getPathBreadcrumbSegments(activeFullPath);
  const headerClassName = [
    "code-editor-header",
    "editor-surface__header",
    "editor-surface__header--tabs",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const openContextMenu = useCallback((event: MouseEvent<HTMLElement>, tab: WorkspaceEditorTab) => {
    event.preventDefault();
    setContextMenu({ tab, x: event.clientX, y: event.clientY });
  }, []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const contextMenuItems = useMemo<TabContextMenuItem[]>(() => {
    if (!contextMenu) {
      return [];
    }

    const tab = contextMenu.tab;
    const items: TabContextMenuItem[] = [];
    if (tab.kind === "file" && tab.pinned === false && onKeepOpenEditorTab) {
      items.push({
        id: "keep-open",
        label: t("code_editor.keep_tab_open"),
        onSelect: () => onKeepOpenEditorTab(tab),
      });
    }

    items.push(
      {
        id: "close",
        label: t("action.close"),
        disabled: !onCloseEditorTab && !(tab.kind === "file" && onCloseOpenFilePath),
        onSelect: () => {
          if (onCloseEditorTab) {
            onCloseEditorTab(tab);
          } else if (tab.kind === "file") {
            onCloseOpenFilePath?.(tab.path);
          }
        },
      },
      {
        id: "close-others",
        label: t("code_editor.close_other_tabs"),
        disabled: !onCloseOtherEditorTabs,
        onSelect: () => onCloseOtherEditorTabs?.(tab),
      },
      {
        id: "close-to-right",
        label: t("code_editor.close_tabs_to_right"),
        disabled: !onCloseEditorTabsToRight,
        onSelect: () => onCloseEditorTabsToRight?.(tab),
      },
      {
        id: "close-saved",
        label: t("code_editor.close_saved_tabs"),
        disabled: !onCloseSavedEditorTabs,
        onSelect: () => onCloseSavedEditorTabs?.(),
      },
      {
        id: "close-all",
        label: t("action.close_all"),
        disabled: !onCloseAllEditorTabs,
        onSelect: () => onCloseAllEditorTabs?.(),
      }
    );

    return items;
  }, [
    contextMenu,
    onCloseAllEditorTabs,
    onCloseEditorTab,
    onCloseEditorTabsToRight,
    onCloseOpenFilePath,
    onCloseOtherEditorTabs,
    onCloseSavedEditorTabs,
    onKeepOpenEditorTab,
    t,
  ]);

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, contextMenu.x),
      Math.max(8, window.innerWidth - rect.width - 8)
    );
    const top = Math.min(
      Math.max(8, contextMenu.y),
      Math.max(8, window.innerHeight - rect.height - 8)
    );
    menuRef.current.style.left = `${left}px`;
    menuRef.current.style.top = `${top}px`;
    menuRef.current.focus();
  }, [contextMenu, contextMenuItems]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (menuRef.current?.contains(event.target)) {
        return;
      }

      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeContextMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  return (
    <header className={headerClassName}>
      <div className="code-editor-tabbar">
        {visibleEditorTabs.length > 0 ? (
          <div
            className="code-editor-tabs"
            role="tablist"
            aria-label={t("code_editor.open_editor_tabs")}
          >
            {visibleEditorTabs.map((tab) => {
              if (tab.kind === "browser") {
                const isActive = isSameEditorTab(activeEditorTab, tab);
                const tabItemClassName = [
                  "code-editor-tab-item",
                  "code-editor-tab-item--browser",
                  isActive ? "code-editor-tab-item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const tabClassName = [
                  "code-editor-tab",
                  "code-editor-tab--browser",
                  isActive ? "code-editor-tab--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const closeLabel = t("code_editor.close_browser_tab");
                const handleCloseTab = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  onCloseEditorTab?.(tab);
                };

                return (
                  <div key={tab.id} className={tabItemClassName}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={tabClassName}
                      title={tab.url ?? t("dev_browser.title")}
                      onClick={() => onActivateEditorTab?.(tab)}
                      onContextMenu={(event) => openContextMenu(event, tab)}
                    >
                      <span className="code-editor-tab__icon" aria-hidden="true">
                        <Globe size={14} />
                      </span>
                      <span className="code-editor-tab__copy">
                        <span className="code-editor-tab__name">
                          {tab.url ?? t("dev_browser.title")}
                        </span>
                      </span>
                    </button>
                    {onCloseEditorTab ? (
                      <button
                        type="button"
                        className="code-editor-tab__close"
                        aria-label={closeLabel}
                        title={closeLabel}
                        onClick={handleCloseTab}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                );
              }

              if (tab.kind === "canvas") {
                const isActive = isSameEditorTab(activeEditorTab, tab);
                const tabItemClassName = [
                  "code-editor-tab-item",
                  "code-editor-tab-item--canvas",
                  isActive ? "code-editor-tab-item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const tabClassName = [
                  "code-editor-tab",
                  "code-editor-tab--canvas",
                  isActive ? "code-editor-tab--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const closeLabel = t("code_editor.close_editor_tab", { name: tab.title });
                const handleCloseTab = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  onCloseEditorTab?.(tab);
                };

                return (
                  <div key={tab.id} className={tabItemClassName}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={tabClassName}
                      title={tab.sourcePath}
                      onClick={() => onActivateEditorTab?.(tab)}
                      onContextMenu={(event) => openContextMenu(event, tab)}
                    >
                      <span className="code-editor-tab__icon" aria-hidden="true">
                        <PanelsTopLeft size={14} />
                      </span>
                      <span className="code-editor-tab__copy">
                        <span className="code-editor-tab__name">{tab.title}</span>
                        {tab.artifactType ? (
                          <span className="code-editor-tab__folder">
                            {tab.artifactType === "architecture_canvas" ? "ARCH" : "REPORT"}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {onCloseEditorTab ? (
                      <button
                        type="button"
                        className="code-editor-tab__close"
                        aria-label={closeLabel}
                        title={closeLabel}
                        onClick={handleCloseTab}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                );
              }

              const path = tab.path;
              const fileName = getFileName(path);
              const openFile = openFiles[path];
              const fullPath =
                openFile?.displayPath ?? getFullWorkspaceFilePath(workspaceRootPath, path);
              const isActive = activeEditorTab
                ? isSameEditorTab(activeEditorTab, tab)
                : path === activeFilePath;
              const isDirty = isDirtyFile(openFile);
              const isPreview = tab.pinned === false;
              const parentFolder =
                (fileNameCounts[fileName] ?? 0) > 1 ? getParentFolderName(path) : null;
              const tabItemClassName = [
                "code-editor-tab-item",
                isActive ? "code-editor-tab-item--active" : "",
                isDirty ? "code-editor-tab-item--dirty" : "",
                isPreview ? "code-editor-tab-item--preview" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const tabClassName = [
                "code-editor-tab",
                isActive ? "code-editor-tab--active" : "",
                isDirty ? "code-editor-tab--dirty" : "",
                isPreview ? "code-editor-tab--preview" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const closeLabel = t("code_editor.close_editor_tab", { name: fileName });
              const handleCloseTab = (event: MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                if (onCloseEditorTab) {
                  onCloseEditorTab(tab);
                  return;
                }

                onCloseOpenFilePath?.(path);
              };
              const handleDoubleClickTab = (event: MouseEvent<HTMLButtonElement>) => {
                if (!isPreview || !onKeepOpenEditorTab) {
                  return;
                }

                event.preventDefault();
                onKeepOpenEditorTab(tab);
              };

              return (
                <div key={path} className={tabItemClassName}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={tabClassName}
                    title={fullPath}
                    onContextMenu={(event) => openContextMenu(event, tab)}
                    onClick={() =>
                      onActivateEditorTab ? onActivateEditorTab(tab) : onActivateOpenFile(path)
                    }
                    onDoubleClick={handleDoubleClickTab}
                  >
                    <span className="code-editor-tab__icon" aria-hidden="true">
                      {getFileTypeLabel(path)}
                    </span>
                    <span className="code-editor-tab__copy">
                      <span className="code-editor-tab__name">{fileName}</span>
                      {parentFolder ? (
                        <span className="code-editor-tab__folder">{parentFolder}</span>
                      ) : null}
                    </span>
                    {isDirty ? (
                      <span
                        className="dirty-indicator code-editor-tab__dirty-indicator"
                        aria-label={t("code_editor.unsaved_changes")}
                        title={t("code_editor.unsaved_changes")}
                      />
                    ) : null}
                  </button>
                  {onCloseOpenFilePath ? (
                    <button
                      type="button"
                      className="code-editor-tab__close"
                      aria-label={closeLabel}
                      title={closeLabel}
                      onClick={handleCloseTab}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="code-editor-tabs code-editor-tabs--empty">
            <span className="code-file-path" title={emptyLabel}>
              <span className="code-file-path__name">{emptyLabel}</span>
            </span>
          </div>
        )}
        {tabbarActions ? <div className="code-editor-tabbar__actions">{tabbarActions}</div> : null}
      </div>

      {showPathRow ? (
        <nav
          className="code-editor-path"
          aria-label={t("code_editor.current_file_path")}
          title={activeFullPath}
        >
          <div className="code-editor-path__trail">
            {activeBreadcrumbSegments.map((segment, index) => (
              <span
                key={`${segment}-${index}`}
                className={`code-editor-path__segment${
                  index === activeBreadcrumbSegments.length - 1
                    ? " code-editor-path__segment--file"
                    : ""
                }`}
              >
                {index === activeBreadcrumbSegments.length - 1 && activeFilePath ? (
                  <FileCode2 size={13} aria-hidden="true" />
                ) : null}
                <span className="code-editor-path__text">{segment}</span>
              </span>
            ))}
          </div>
          {dirtyStatusLabel || pathActions ? (
            <div className="code-editor-path__actions">
              {dirtyStatusLabel ? (
                <span className="code-editor-path__state">{dirtyStatusLabel}</span>
              ) : null}
              {pathActions}
            </div>
          ) : null}
        </nav>
      ) : null}
      {contextMenu ? (
        <div className="file-context-menu-layer">
          <div
            ref={menuRef}
            role="menu"
            tabIndex={-1}
            aria-label={t("code_editor.editor_tab_actions")}
            className="file-context-menu code-editor-tab-context-menu"
            style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="file-context-menu__section">
              <div className="file-context-menu__section-items">
                {contextMenuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="file-context-menu__item"
                    disabled={item.disabled}
                    onClick={() => {
                      if (item.disabled) {
                        return;
                      }

                      item.onSelect();
                      closeContextMenu();
                    }}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
