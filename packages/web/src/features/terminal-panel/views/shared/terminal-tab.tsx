/**
 * Terminal Tab Component
 *
 * Renders a single terminal tab with metadata.
 */

import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { IconButton, Tab } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { terminalMetaAtomFamily } from "../../atoms";
import { formatTerminalTitle } from "../../components/title-format";

interface TerminalTabProps {
  id: string;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function TerminalTab({ id, index, isActive, onSelect, onClose }: TerminalTabProps) {
  const t = useTranslation();
  const meta = useAtomValue(terminalMetaAtomFamily(id));

  const title = formatTerminalTitle(meta, index, t("terminal.shell"));

  return (
    <div className={`terminal-tab-shell ${isActive ? "active" : ""}`} role="presentation">
      <Tab
        className={`terminal-tab ${isActive ? "terminal-tab-active" : ""}`}
        onClick={onSelect}
        value={id}
      >
        <span className="terminal-tab-title">{title}</span>
        {meta?.kind === "task" ? (
          <span className="terminal-managed-badge">{t("terminal.managed_task")}</span>
        ) : null}
      </Tab>
      <IconButton
        aria-label={t("action.close")}
        className="terminal-tab-close"
        icon={<X size={12} />}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        size="sm"
      />
    </div>
  );
}

export default TerminalTab;
