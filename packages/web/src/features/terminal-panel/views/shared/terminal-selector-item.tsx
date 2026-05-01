/**
 * Terminal Selector Item Component
 *
 * Renders a single terminal item in the selector dropdown.
 */

import { useAtomValue } from 'jotai';
import { X } from 'lucide-react';
import { terminalMetaAtomFamily } from '../../atoms/terminals';
import { useTranslation } from '../../../../lib/i18n';
import { formatTerminalTitle } from '../../components/title-format';

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

  const title = formatTerminalTitle(meta, index, t('terminal.shell'));

  return (
    <div
      className={`terminal-selector-item ${
        isActive ? 'terminal-selector-item-active' : ''
      }`}
    >
      <button
        className="terminal-selector-item-trigger"
        onClick={onSelect}
      >
        <span className="terminal-selector-item-title">{title}</span>
      </button>
      <button
        className="terminal-selector-item-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default TerminalSelectorItem;
