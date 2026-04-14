/**
 * Command Palette Component
 *
 * Modal overlay for quick command access via Ctrl+K.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Search } from 'lucide-react';
import {
  commandPaletteOpenAtom,
  focusModeAtom,
  activeWorkspaceIdAtom,
  sidebarCollapsedAtom,
  bottomPanelHeightAtom,
} from '../../../atoms/ui';
import { workspacesAtom } from '../../../atoms/workspaces';
import { useTranslation } from '../../../lib/i18n';

interface Command {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  action: () => void;
}

/**
 * Command Palette
 *
 * PRD §12:
 *   - Modal dialog (660px max width)
 *   - Header: "COMMAND PALETTE" + action count
 *   - Search input with filter
 *   - Command list with labels, descriptions, shortcuts
 *   - Keyboard navigation (arrows, enter, escape)
 */
export function CommandPalette() {
  const t = useTranslation();
  const [isOpen, setIsOpen] = useAtom(commandPaletteOpenAtom);
  const [focusMode, setFocusMode] = useAtom(focusModeAtom);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(workspacesAtom);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build command list
  const commands = buildCommands({
    focusMode,
    setFocusMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    bottomPanelHeight,
    setBottomPanelHeight,
    activeWorkspaceId,
    workspaces,
    t,
  });

  // Filter commands by search
  const filteredCommands = commands.filter((cmd) => {
    const query = searchQuery.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query) ||
      (cmd.shortcut && cmd.shortcut.toLowerCase().includes(query))
    );
  });

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setSearchQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            setIsOpen(false);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [filteredCommands, selectedIndex, setIsOpen]
  );

  // Global keyboard shortcut (Ctrl+K)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, setIsOpen]);

  // Handle command execution
  const handleCommandClick = (cmd: Command) => {
    cmd.action();
    setIsOpen(false);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onClick={() => setIsOpen(false)}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-header">
          <span className="command-palette-kicker">{t('command.palette').toUpperCase()}</span>
          <span className="command-palette-meta">
            {t('command.palette')} ({filteredCommands.length})
          </span>
        </div>

        <div className="command-palette-search">
          <Search size={16} className="command-palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={t('placeholder.command')}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>

        <div className="command-palette-hint">
          {t('placeholder.command')}
        </div>

        <div className="command-palette-list">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, index) => (
              <div
                key={cmd.id}
                className={`command-palette-item ${
                  index === selectedIndex ? 'command-palette-item-selected' : ''
                }`}
                onClick={() => handleCommandClick(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="command-palette-item-content">
                  <span className="command-palette-item-label">{cmd.label}</span>
                  <span className="command-palette-item-desc">{cmd.description}</span>
                </div>
                {cmd.shortcut && (
                  <span className="command-palette-item-shortcut">{cmd.shortcut}</span>
                )}
              </div>
            ))
          ) : (
            <div className="command-palette-empty">
              {t('command.no_results')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Build available commands based on current state
 */
function buildCommands(context: {
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  bottomPanelHeight: number;
  setBottomPanelHeight: (v: number) => void;
  activeWorkspaceId: string | null;
  workspaces: Record<string, { id: string; path: string }>;
  t: (key: string) => string;
}): Command[] {
  const {
    focusMode,
    setFocusMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    bottomPanelHeight,
    setBottomPanelHeight,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    activeWorkspaceId: _activeWorkspaceId,
    workspaces,
    t,
  } = context;

  const commands: Command[] = [
    {
      id: 'new-workspace',
      label: t('workspace.open'),
      description: t('workspace.open_hint'),
      shortcut: 'Ctrl+N',
      action: () => {
        // TODO: Open workspace launch modal
        console.log('Open workspace launch modal');
      },
    },
    {
      id: 'toggle-focus-mode',
      label: t('tooltip.focus_mode'),
      description: focusMode ? t('action.close') : t('action.open'),
      shortcut: 'F',
      action: () => setFocusMode(!focusMode),
    },
    {
      id: 'toggle-sidebar',
      label: t('command.shortcut.toggle_sidebar'),
      description: sidebarCollapsed ? t('action.open') : t('action.close'),
      action: () => setSidebarCollapsed(!sidebarCollapsed),
    },
    {
      id: 'toggle-terminal',
      label: t('terminal.title'),
      description: bottomPanelHeight === 0 ? t('action.open') : t('action.close'),
      action: () => setBottomPanelHeight(bottomPanelHeight === 0 ? 200 : 0),
    },
    {
      id: 'open-settings',
      label: t('action.settings'),
      description: t('settings.title'),
      action: () => {
        // TODO: Navigate to settings
        console.log('Navigate to settings');
      },
    },
  ];

  // Add workspace switch commands
  Object.values(workspaces).forEach((ws) => {
    commands.push({
      id: `switch-workspace-${ws.id}`,
      label: `${t('workspace.title')}: ${ws.path.split('/').pop()}`,
      description: ws.path,
      action: () => {
        // TODO: Switch to workspace
        console.log('Switch to workspace:', ws.id);
      },
    });
  });

  return commands;
}

export default CommandPalette;
