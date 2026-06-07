import type { FC } from "react";
import { ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import type { IconSemantic } from "../../../../theme";
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
    icon: IconSemantic;
  }> = [
    { view: "explorer", label: t("workspace.sidebar.explorer"), icon: "nav.explorer" },
    { view: "search", label: t("workspace.sidebar.search"), icon: "nav.search" },
    {
      view: "source-control",
      label: t("workspace.sidebar.source_control"),
      icon: "nav.sourceControl",
    },
  ];

  return (
    <nav className="workspace-activity-bar" aria-label={t("workspace.sidebar.label")}>
      {items.map(({ view, label, icon }) => (
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
          <span className="workspace-activity-bar__glyph" aria-hidden="true">
            <ThemedIcon semantic={icon} size={18} />
          </span>
          <span className="workspace-activity-bar__label">{label}</span>
        </button>
      ))}
    </nav>
  );
};
