import { FolderTree, GitBranch, Search } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "../../../../lib/i18n";
import type { DesktopSidebarView } from "../../atoms/layout";

interface WorkspaceActivityBarProps {
  activeView: DesktopSidebarView;
  onSelectView: (view: DesktopSidebarView) => void;
}

export const WorkspaceActivityBar: FC<WorkspaceActivityBarProps> = ({
  activeView,
  onSelectView,
}) => {
  const t = useTranslation();
  const items: Array<{
    view: DesktopSidebarView;
    label: string;
    icon: typeof FolderTree;
  }> = [
    { view: "explorer", label: t("workspace.sidebar.explorer"), icon: FolderTree },
    { view: "search", label: t("workspace.sidebar.search"), icon: Search },
    {
      view: "source-control",
      label: t("workspace.sidebar.source_control"),
      icon: GitBranch,
    },
  ];

  return (
    <nav className="workspace-activity-bar" aria-label={t("workspace.sidebar.label")}>
      {items.map(({ view, label, icon: Icon }) => (
        <button
          key={view}
          type="button"
          className={`workspace-activity-bar__button ${
            activeView === view ? "workspace-activity-bar__button--active" : ""
          }`}
          aria-label={label}
          aria-pressed={activeView === view}
          onClick={() => onSelectView(view)}
        >
          <Icon size={18} aria-hidden="true" />
          <span className="workspace-activity-bar__label">{label}</span>
        </button>
      ))}
    </nav>
  );
};
