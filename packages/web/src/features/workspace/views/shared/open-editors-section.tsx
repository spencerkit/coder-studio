import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  hasPendingEditorLoad,
  subscribeToPendingEditorLoads,
} from "../../../code-editor/actions/pending-editor-loads";
import { orderOpenEditorPaths } from "../../actions/open-editors-close";
import { useOpenEditorsActions } from "../../actions/use-open-editors-actions";
import { useOpenWorkspaceFile } from "../../actions/use-open-workspace-file";
import {
  activeFilePathAtomFamily,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";

interface OpenEditorsSectionProps {
  workspaceId: string;
  onSelectFile?: (path: string) => void;
  title?: string;
}

type PendingCloseRequest =
  | {
      kind: "path";
      path: string;
    }
  | {
      dirtyCount: number;
      kind: "all";
    };

export function OpenEditorsSection({ workspaceId, onSelectFile, title }: OpenEditorsSectionProps) {
  const t = useTranslation();
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const persistedOpenEditorPaths = useAtomValue(openEditorPathsAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);
  const { closeAll, closePath } = useOpenEditorsActions(workspaceId);
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCloseRequest, setPendingCloseRequest] = useState<PendingCloseRequest | null>(null);
  const [, setPendingLoadVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToPendingEditorLoads(workspaceId, () =>
      setPendingLoadVersion((v) => v + 1)
    );
    setPendingLoadVersion((v) => v + 1);
    return unsubscribe;
  }, [workspaceId]);

  const pendingActivePath =
    activeFilePath &&
    !(activeFilePath in openFiles) &&
    hasPendingEditorLoad(workspaceId, activeFilePath)
      ? activeFilePath
      : null;
  const openEditorPaths = orderOpenEditorPaths([
    ...persistedOpenEditorPaths,
    ...Object.keys(openFiles),
    ...(pendingActivePath ? [pendingActivePath] : []),
  ]);
  const resolvedTitle = title ?? t("workspace.sidebar.open_editors");
  const headingLabel = t("workspace.open_editors.title_with_count", {
    count: openEditorPaths.length,
    title: resolvedTitle,
  });
  const canExpand = openEditorPaths.length > 0;
  const isExpanded = canExpand && !collapsed;
  const toggleLabel = isExpanded
    ? t("workspace.open_editors.collapse_label")
    : t("workspace.open_editors.expand_label");
  const dirtyOpenEditorPaths = Object.values(openFiles)
    .filter((file) => file.kind === "text" && file.isDirty)
    .map((file) => file.path);
  const closeConfirmDescription =
    pendingCloseRequest?.kind === "path"
      ? t("code_editor.close_unsaved_description", { name: pendingCloseRequest.path })
      : pendingCloseRequest?.kind === "all"
        ? t("workspace.open_editors.close_all_unsaved_description", {
            count: pendingCloseRequest.dirtyCount,
          })
        : undefined;
  const requestClosePath = (path: string) => {
    const file = openFiles[path];
    if (file?.kind === "text" && file.isDirty) {
      setPendingCloseRequest({ kind: "path", path });
      return;
    }

    closePath(path);
  };
  const requestCloseAll = () => {
    if (dirtyOpenEditorPaths.length > 0) {
      setPendingCloseRequest({ dirtyCount: dirtyOpenEditorPaths.length, kind: "all" });
      return;
    }

    closeAll();
  };
  const confirmPendingClose = () => {
    const request = pendingCloseRequest;
    setPendingCloseRequest(null);

    if (!request) {
      return;
    }

    if (request.kind === "path") {
      closePath(request.path);
      return;
    }

    closeAll();
  };

  return (
    <section className="workspace-sidebar-section">
      <div className="workspace-open-editors__header">
        <div className="workspace-open-editors__header-main">
          <Tooltip content={toggleLabel}>
            <IconButton
              aria-label={toggleLabel}
              aria-expanded={canExpand ? isExpanded : undefined}
              className="workspace-open-editors__toggle"
              disabled={!canExpand}
              icon={isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              size="sm"
              onClick={() => setCollapsed((value) => !value)}
            />
          </Tooltip>
          <h2
            className="workspace-sidebar-section__title workspace-open-editors__title"
            aria-label={headingLabel}
          >
            <span className="workspace-open-editors__title-text">{resolvedTitle}</span>
          </h2>
          <span className="workspace-sidebar-section__count workspace-open-editors__count">
            {openEditorPaths.length}
          </span>
        </div>
        <button
          type="button"
          className="workspace-sidebar-section__action workspace-open-editors__close-all"
          disabled={openEditorPaths.length === 0}
          onClick={requestCloseAll}
          title={headingLabel}
        >
          {t("action.close_all")}
        </button>
      </div>
      {isExpanded ? (
        <div className="workspace-open-editors">
          {openEditorPaths.map((path) => {
            const file = openFiles[path];
            const isDirtyTextFile = file?.kind === "text" && file.isDirty;

            return (
              <div key={path} className="workspace-open-editors__row">
                <button
                  type="button"
                  className={`workspace-open-editors__item workspace-sidebar-row ${
                    activeFilePath === path
                      ? "workspace-open-editors__item--active workspace-sidebar-row--selected"
                      : ""
                  }`}
                  aria-current={activeFilePath === path ? "true" : undefined}
                  aria-label={path}
                  title={path}
                  onClick={() => {
                    void openWorkspaceFile({
                      workspaceId,
                      path,
                      source: "manual",
                    });
                    onSelectFile?.(path);
                  }}
                >
                  <span className="workspace-open-editors__item-content">
                    <span className="workspace-open-editors__item-label">{path}</span>
                    {isDirtyTextFile ? (
                      <span
                        className="workspace-open-editors__dirty-indicator"
                        title={t("code_editor.unsaved_changes")}
                      />
                    ) : null}
                  </span>
                </button>
                <Tooltip content={t("action.close")}>
                  <IconButton
                    aria-label={t("workspace.open_editors.close_path", { path })}
                    className="workspace-open-editors__item-close"
                    icon={<X size={14} />}
                    size="sm"
                    onClick={() => requestClosePath(path)}
                  />
                </Tooltip>
              </div>
            );
          })}
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingCloseRequest !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCloseRequest(null);
          }
        }}
        title={t("code_editor.close_unsaved_title")}
        description={closeConfirmDescription}
        cancelText={t("common.cancel")}
        confirmText={t("code_editor.discard_and_close")}
        tone="danger"
        onConfirm={confirmPendingClose}
      />
    </section>
  );
}
