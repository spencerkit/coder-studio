import { ChevronsUp } from "lucide-react";
import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface WorkspaceSectionHeaderProps {
  onOpenFileCreate?: () => void;
  onOpenFolderCreate?: () => void;
  onCollapseAll?: () => void;
}

export function WorkspaceSectionHeader({
  onOpenFileCreate,
  onOpenFolderCreate,
  onCollapseAll,
}: WorkspaceSectionHeaderProps) {
  const t = useTranslation();

  return (
    <div className="workspace-sidebar-section__header">
      <h2 className="workspace-sidebar-section__title">{t("workspace.sidebar.workspace")}</h2>
      <div className="workspace-sidebar-panel__actions workspace-sidebar-section__actions">
        <Tooltip content={t("file.new_file")}>
          <IconButton
            className="panel-toolbar-btn"
            aria-label={t("file.new_file")}
            icon={<ThemedIcon semantic="file.action.new" size={14} />}
            onClick={onOpenFileCreate}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("file.new_folder")}>
          <IconButton
            className="panel-toolbar-btn"
            aria-label={t("file.new_folder")}
            icon={<ThemedIcon semantic="file.action.newFolder" size={14} />}
            onClick={onOpenFolderCreate}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("file.collapse_all")}>
          <IconButton
            className="panel-toolbar-btn"
            aria-label={t("file.collapse_all")}
            icon={<ChevronsUp size={14} />}
            onClick={onCollapseAll}
            size="sm"
          />
        </Tooltip>
      </div>
    </div>
  );
}
