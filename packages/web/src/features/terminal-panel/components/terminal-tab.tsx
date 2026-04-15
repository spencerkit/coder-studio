/**
 * Terminal Tab Component
 *
 * Renders a single terminal tab with metadata.
 */

import { useAtomValue } from 'jotai';
import { X } from 'lucide-react';
import { terminalMetaAtomFamily } from '../../../atoms/terminals';
import { useTranslation } from '../../../lib/i18n';

interface TerminalTabProps {
  id: string;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function TerminalTab({ id, isActive, onSelect, onClose }: TerminalTabProps) {
  const t = useTranslation();
  const meta = useAtomValue(terminalMetaAtomFamily(id));

  const title = meta?.title || t('terminal.shell');

  return (
    <div className={`terminal-tab ${isActive ? 'terminal-tab-active' : ''}`}>
      <button
        className="terminal-tab-label"
        onClick={onSelect}
      >
        <span className="terminal-tab-title">{title}</span>
      </button>
      <button
        className="terminal-tab-close"
        onClick={onClose}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default TerminalTab;