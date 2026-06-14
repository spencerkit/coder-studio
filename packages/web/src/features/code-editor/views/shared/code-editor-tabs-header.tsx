import { FileCode2, Globe, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
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
  onCloseEditorTab?: (tab: WorkspaceEditorTab) => void;
  onCloseOpenFilePath?: (path: string) => void;
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

  return false;
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
  onCloseEditorTab,
  onCloseOpenFilePath,
  openEditorTabs,
  openEditorPaths,
  openFiles,
  pathActions,
  showPathRow = true,
  tabbarActions,
  workspaceRootPath,
}: CodeEditorTabsHeaderProps) {
  const t = useTranslation();
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

              const path = tab.path;
              const fileName = getFileName(path);
              const openFile = openFiles[path];
              const fullPath =
                openFile?.displayPath ?? getFullWorkspaceFilePath(workspaceRootPath, path);
              const isActive = activeEditorTab
                ? isSameEditorTab(activeEditorTab, tab)
                : path === activeFilePath;
              const isDirty = isDirtyFile(openFile);
              const parentFolder =
                (fileNameCounts[fileName] ?? 0) > 1 ? getParentFolderName(path) : null;
              const tabItemClassName = [
                "code-editor-tab-item",
                isActive ? "code-editor-tab-item--active" : "",
                isDirty ? "code-editor-tab-item--dirty" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const tabClassName = [
                "code-editor-tab",
                isActive ? "code-editor-tab--active" : "",
                isDirty ? "code-editor-tab--dirty" : "",
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

              return (
                <div key={path} className={tabItemClassName}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={tabClassName}
                    title={fullPath}
                    onClick={() =>
                      onActivateEditorTab ? onActivateEditorTab(tab) : onActivateOpenFile(path)
                    }
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
    </header>
  );
}
