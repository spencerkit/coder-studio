import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  hasPendingEditorLoad,
  subscribeToPendingEditorLoads,
} from "../../../code-editor/actions/pending-editor-loads";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import { orderOpenEditorPaths } from "../../actions/open-editors-close";
import { useOpenEditorsActions } from "../../actions/use-open-editors-actions";
import {
  activeFilePathAtomFamily,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";

interface OpenEditorsSectionProps {
  workspaceId: string;
  onSelectFile?: (path: string) => void;
  title?: string;
}

export function OpenEditorsSection({ workspaceId, onSelectFile, title }: OpenEditorsSectionProps) {
  const t = useTranslation();
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const { closeAll, closePath } = useOpenEditorsActions(workspaceId);
  const [collapsed, setCollapsed] = useState(false);
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
  const openEditorPaths = pendingActivePath
    ? [...orderOpenEditorPaths(openFiles), pendingActivePath].sort()
    : orderOpenEditorPaths(openFiles);
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
          onClick={() => closeAll()}
          title={headingLabel}
        >
          {t("action.close_all")}
        </button>
      </div>
      {isExpanded ? (
        <div className="workspace-open-editors">
          {openEditorPaths.map((path) => (
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
                  setEditorMode(deriveEditorModeForPath(path));
                  void openLocation({
                    workspaceId,
                    path,
                    source: "manual",
                  });
                  onSelectFile?.(path);
                }}
              >
                <span className="workspace-open-editors__item-label">{path}</span>
              </button>
              <Tooltip content={t("action.close")}>
                <IconButton
                  aria-label={t("workspace.open_editors.close_path", { path })}
                  className="workspace-open-editors__item-close"
                  icon={<X size={14} />}
                  size="sm"
                  onClick={() => closePath(path)}
                />
              </Tooltip>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
