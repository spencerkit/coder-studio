import { ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

type MobileDockItem = "agent" | "files" | "terminal";

interface MobileDockProps {
  activeItem: MobileDockItem | null;
  onSelectItem: (item: MobileDockItem) => void;
}

export function MobileDock({ activeItem, onSelectItem }: MobileDockProps) {
  const t = useTranslation();

  return (
    <nav className="mobile-dock" aria-label={t("mobile.dock.aria_label")}>
      <button
        type="button"
        className={`mobile-dock__item ${activeItem === "agent" ? "mobile-dock__item--active" : ""}`}
        onClick={() => onSelectItem("agent")}
        aria-label={t("mobile.dock.open_agent")}
      >
        <span className="mobile-dock__icon" aria-hidden="true">
          <ThemedIcon semantic="mobile.dock.agent" size={18} />
        </span>
        <span className="mobile-dock__label">{t("label.agent")}</span>
      </button>

      <button
        type="button"
        className={`mobile-dock__item ${activeItem === "files" ? "mobile-dock__item--active" : ""}`}
        onClick={() => onSelectItem("files")}
        aria-label={t("mobile.dock.open_files")}
      >
        <span className="mobile-dock__icon" aria-hidden="true">
          <ThemedIcon semantic="mobile.dock.files" size={18} />
        </span>
        <span className="mobile-dock__label">{t("file.title")}</span>
      </button>

      <button
        type="button"
        className={`mobile-dock__item ${activeItem === "terminal" ? "mobile-dock__item--active" : ""}`}
        onClick={() => onSelectItem("terminal")}
        aria-label={t("mobile.dock.open_terminal")}
      >
        <span className="mobile-dock__icon" aria-hidden="true">
          <ThemedIcon semantic="mobile.dock.terminal" size={18} />
        </span>
        <span className="mobile-dock__label">{t("label.terminal")}</span>
      </button>
    </nav>
  );
}
