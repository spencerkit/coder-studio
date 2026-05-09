/**
 * Terminal Selector Item Component
 *
 * Renders a single terminal item in the selector dropdown.
 */

import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { IconButton } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { terminalMetaAtomFamily } from "../../atoms";
import { formatTerminalTitle } from "../../components/title-format";

interface TerminalSelectorItemProps {
  id: string;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function TerminalSelectorItem({
  id,
  index,
  isActive,
  onSelect,
  onClose,
}: TerminalSelectorItemProps) {
  const t = useTranslation();
  const meta = useAtomValue(terminalMetaAtomFamily(id));

  const title = formatTerminalTitle(meta, index, t("terminal.shell"));

  return (
    <div className={`terminal-selector-item ${isActive ? "terminal-selector-item-active" : ""}`}>
      <button type="button" className="terminal-selector-item-trigger" onClick={onSelect}>
        <span className="terminal-selector-item-title">{title}</span>
      </button>
      <IconButton
        aria-label={t("action.close")}
        className="terminal-selector-item-close"
        icon={<X size={12} />}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        size="sm"
      />
    </div>
  );
}

export default TerminalSelectorItem;
