import { ChevronsUp } from "lucide-react";
import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface WorkspaceSectionHeaderProps {
  count?: number;
  onOpenFileCreate?: () => void;
  onOpenFolderCreate?: () => void;
  onCollapseAll?: () => void;
  showCollapseAction?: boolean;
}

export function WorkspaceSectionHeader({
  count,
  onOpenFileCreate,
  onOpenFolderCreate,
  onCollapseAll,
  showCollapseAction = true,
}: WorkspaceSectionHeaderProps) {
  const t = useTranslation();

  return (
    <div className="workspace-sidebar-section__header">
      <div className="workspace-sidebar-section__header-main">
        <span className="workspace-sidebar-section__chevron" aria-hidden="true">
          ▾
        </span>
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
