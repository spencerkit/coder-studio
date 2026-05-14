import { ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface MobileDockProps {
  activeItem: "agent" | "files" | "terminal" | null;
  onSelectItem: (item: "agent" | "files" | "terminal") => void;
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
          <ThemedIcon semantic="nav.agent" size={18} />
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
          <ThemedIcon semantic="nav.panelFiles" size={18} />
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
          <ThemedIcon semantic="nav.panelTerminal" size={18} />
        </span>
        <span className="mobile-dock__label">{t("label.terminal")}</span>
      </button>
    </nav>
  );
}
