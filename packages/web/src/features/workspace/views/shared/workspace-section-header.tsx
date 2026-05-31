import { ChevronDown, ChevronRight, ChevronsUp } from "lucide-react";
import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface WorkspaceSectionHeaderProps {
  count?: number;
  isExpanded: boolean;
  panelId: string;
  onToggleExpanded: () => void;
  onOpenFileCreate?: () => void;
  onOpenFolderCreate?: () => void;
  onCollapseAll?: () => void;
  showCollapseAction?: boolean;
}

export function WorkspaceSectionHeader({
  count,
  isExpanded,
  panelId,
  onToggleExpanded,
  onOpenFileCreate,
  onOpenFolderCreate,
  onCollapseAll,
  showCollapseAction = true,
}: WorkspaceSectionHeaderProps) {
  const t = useTranslation();
  const toggleLabel = isExpanded
    ? t("workspace.sidebar.workspace_collapse_label")
    : t("workspace.sidebar.workspace_expand_label");

  return (
    <div className="workspace-sidebar-section__header">
      <div className="workspace-sidebar-section__header-main">
        <Tooltip content={toggleLabel}>
          <IconButton
            aria-controls={panelId}
            aria-expanded={isExpanded}
            aria-label={toggleLabel}
            className="workspace-sidebar-section__chevron"
            icon={isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            onClick={onToggleExpanded}
            size="sm"
          />
        </Tooltip>
        <h2 className="workspace-sidebar-section__title">{t("workspace.sidebar.workspace")}</h2>
        {count === undefined ? null : (
          <span className="workspace-sidebar-section__count">{count}</span>
        )}
      </div>
      <div className="workspace-sidebar-panel__actions workspace-sidebar-section__actions">
        <Tooltip content={t("file.new_file")}>
          <IconButton
            aria-label={t("file.new_file")}
            className="panel-toolbar-btn"
            icon={<ThemedIcon semantic="file.action.new" size={14} />}
            onClick={onOpenFileCreate}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("file.new_folder")}>
          <IconButton
            aria-label={t("file.new_folder")}
            className="panel-toolbar-btn"
            icon={<ThemedIcon semantic="file.action.newFolder" size={14} />}
            onClick={onOpenFolderCreate}
            size="sm"
          />
        </Tooltip>
        {showCollapseAction ? (
          <Tooltip content={t("file.collapse_all")}>
            <IconButton
              aria-label={t("file.collapse_all")}
              className="panel-toolbar-btn"
              icon={<ChevronsUp size={14} />}
              onClick={onCollapseAll}
              size="sm"
            />
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
