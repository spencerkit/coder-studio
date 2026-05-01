/**
 * Command Palette Component
 *
 * Modal overlay for quick command access via Ctrl+K.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  commandPaletteOpenAtom,
  focusModeAtom,
  activeWorkspaceIdAtom,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
  bottomPanelHeightAtom,
} from '../../../atoms/ui';
import { orderedWorkspacesAtom, resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';
import { useViewport } from '../../../hooks/use-viewport';
import { useTranslation } from '../../../lib/i18n';
import { MobileSheet } from '../../../shells/mobile-shell/mobile-sheet';
import { WorkspaceLaunchModal } from '../../workspace/components/workspace-launch-modal';
import type { Workspace } from '@coder-studio/core';

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
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useViewport() === 'mobile';
  const [isOpen, setIsOpen] = useAtom(commandPaletteOpenAtom);
  const [focusMode, setFocusMode] = useAtom(focusModeAtom);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [terminalPanelVisible, setTerminalPanelVisible] = useAtom(terminalPanelVisibleAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showWorkspaceLaunch, setShowWorkspaceLaunch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build command list
  const commands = buildCommands({
    focusMode,
    setFocusMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    terminalPanelVisible,
    setTerminalPanelVisible,
    bottomPanelHeight,
    setBottomPanelHeight,
    activeWorkspaceId,
    setActiveWorkspaceId,
    workspaces,
    locationPathname: location.pathname,
    navigate,
    t,
    setShowWorkspaceLaunch: (nextValue) => {
      if (nextValue) {
        setIsOpen(false);
      }
      setShowWorkspaceLaunch(nextValue);
    },
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

  const paletteSearchField = (
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
  );

  const paletteList = (
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
            {cmd.shortcut ? (
              <span className="command-palette-item-shortcut">{cmd.shortcut}</span>
            ) : null}
          </div>
        ))
      ) : (
        <div className="command-palette-empty">{t('command.no_results')}</div>
      )}
    </div>
  );

  // Show workspace launch modal if triggered
  if (showWorkspaceLaunch) {
    return <WorkspaceLaunchModal onClose={() => setShowWorkspaceLaunch(false)} />;
  }

  if (!isOpen) {
    return null;
  }

  if (isMobile) {
    return (
      <MobileSheet
        title="Quick Actions"
        kicker={t('command.palette').toUpperCase()}
        onClose={() => setIsOpen(false)}
        bodyClassName="mobile-sheet__body--flush"
        contentClassName="command-palette-sheet-layer"
        body={
          <div className="command-palette-sheet-shell" onKeyDown={handleKeyDown}>
            <div className="command-palette-sheet">
              <div className="command-palette-sheet__search">
                {paletteSearchField}
                <div className="command-palette-sheet__meta">
                  <span className="command-palette-hint">{t('placeholder.command')}</span>
                  <span className="command-palette-meta">
                    {filteredCommands.length} actions
                  </span>
                </div>
              </div>
              {paletteList}
            </div>
          </div>
        }
      />
    );
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
            {filteredCommands.length} actions
          </span>
        </div>
        {paletteSearchField}

        <div className="command-palette-hint">
          {t('placeholder.command')}
        </div>
        {paletteList}
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
  terminalPanelVisible: boolean;
  setTerminalPanelVisible: (v: boolean) => void;
  bottomPanelHeight: number;
  setBottomPanelHeight: (v: number) => void;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (v: string | null) => void;
  workspaces: Workspace[];
  locationPathname: string;
  navigate: (path: string) => void;
  t: (key: string) => string;
  setShowWorkspaceLaunch: (v: boolean) => void;
}): Command[] {
  const {
    focusMode,
    setFocusMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    terminalPanelVisible,
    setTerminalPanelVisible,
    bottomPanelHeight,
    setBottomPanelHeight,
    activeWorkspaceId,
    setActiveWorkspaceId,
    workspaces,
    locationPathname,
    navigate,
    t,
    setShowWorkspaceLaunch,
  } = context;

  const commands: Command[] = [
    {
      id: 'new-workspace',
      label: t('workspace.open'),
      description: t('workspace.open_hint'),
      shortcut: 'Ctrl+N',
      action: () => {
        setShowWorkspaceLaunch(true);
      },
    },
    {
      id: 'open-home',
      label: t('workspace.title'),
      description: t('action.back'),
      action: () => navigate('/'),
    },
    {
      id: 'open-settings',
      label: t('action.settings'),
      description: t('settings.title'),
      shortcut: 'Ctrl+,',
      action: () => {
        navigate('/settings');
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
      id: 'enable-focus-mode',
      label: `${t('action.open')} Focus Mode`,
      description: t('tooltip.focus_mode'),
      action: () => setFocusMode(true),
    },
    {
      id: 'disable-focus-mode',
      label: `${t('action.close')} Focus Mode`,
      description: t('tooltip.focus_mode'),
      action: () => setFocusMode(false),
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
      description: !terminalPanelVisible ? t('action.open') : t('action.close'),
      action: () => {
        setTerminalPanelVisible(!terminalPanelVisible);
        if (!terminalPanelVisible && bottomPanelHeight === 0) {
          setBottomPanelHeight(200);
        }
      },
    },
    {
      id: 'show-terminal',
      label: `${t('action.open')} ${t('terminal.title')}`,
      description: t('command.shortcut.toggle_terminal'),
      action: () => {
        setTerminalPanelVisible(true);
        if (bottomPanelHeight === 0) {
          setBottomPanelHeight(200);
        }
      },
    },
    {
      id: 'hide-terminal',
      label: `${t('action.close')} ${t('terminal.title')}`,
      description: t('command.shortcut.toggle_terminal'),
      action: () => setTerminalPanelVisible(false),
    },
  ];

  // Add workspace switch commands
  workspaces.forEach((ws) => {
    const workspaceLabel = ws.name || ws.path?.split('/').pop() || ws.path || ws.id;

    commands.push({
      id: `switch-workspace-${ws.id}`,
      label: `${t('workspace.title')}: ${workspaceLabel}`,
      description: ws.path || ws.id,
      action: () => {
        setActiveWorkspaceId(ws.id);
        if (locationPathname !== '/workspace') {
          navigate('/workspace');
        }
      },
    });
  });

  // Add go home command if in a workspace
  if (activeWorkspaceId) {
    commands.push({
      id: 'go-home',
      label: t('action.back'),
      description: t('workspace.no_workspace'),
      action: () => {
        setActiveWorkspaceId(null);
        navigate('/');
      },
    });
  }

  return commands;
}

export default CommandPalette;
