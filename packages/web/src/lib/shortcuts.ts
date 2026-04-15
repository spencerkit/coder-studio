/**
 * Keyboard Shortcuts Management (Phase 4)
 *
 * Centralized shortcut registry with customization support.
 */

import { atomWithStorage } from 'jotai/utils';

export interface ShortcutDefinition {
  id: string;
  name: string;
  description: string;
  defaultBinding: string;
  category: 'global' | 'workspace' | 'editor' | 'terminal';
}

// Default shortcuts (PRD §5.2)
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Global
  {
    id: 'command-palette.toggle',
    name: '命令面板',
    description: '打开/关闭命令面板',
    defaultBinding: 'Mod+K',
    category: 'global',
  },
  {
    id: 'workspace.new',
    name: '新建工作区',
    description: '打开新的工作区标签',
    defaultBinding: 'Mod+N',
    category: 'global',
  },
  {
    id: 'workspace.previous',
    name: '上一个工作区',
    description: '切换到上一个工作区标签',
    defaultBinding: 'Mod+Shift+[',
    category: 'global',
  },
  {
    id: 'workspace.next',
    name: '下一个工作区',
    description: '切换到下一个工作区标签',
    defaultBinding: 'Mod+Shift+]',
    category: 'global',
  },
  {
    id: 'focus-mode.toggle',
    name: '专注模式',
    description: '切换专注模式（隐藏非必要面板）',
    defaultBinding: 'F',
    category: 'global',
  },
  // Workspace
  {
    id: 'agent.split-vertical',
    name: '垂直分屏',
    description: '垂直分割 Agent 面板',
    defaultBinding: 'Mod+D',
    category: 'workspace',
  },
  {
    id: 'agent.split-horizontal',
    name: '水平分屏',
    description: '水平分割 Agent 面板',
    defaultBinding: 'Mod+Shift+D',
    category: 'workspace',
  },
  // Editor
  {
    id: 'editor.save',
    name: '保存文件',
    description: '保存当前编辑的文件',
    defaultBinding: 'Mod+S',
    category: 'editor',
  },
];

// Custom bindings stored in localStorage
export const customShortcutsAtom = atomWithStorage<Record<string, string>>(
  'ui.customShortcuts',
  {}
);

/**
 * Parse a shortcut binding string into modifiers and key
 */
export function parseShortcut(binding: string): {
  modifiers: string[];
  key: string;
} {
  const parts = binding.split('+');
  const key = parts.pop() || '';
  return {
    modifiers: parts,
    key,
  };
}

/**
 * Format a shortcut for display
 */
export function formatShortcut(binding: string): string {
  return binding
    .replace('Mod', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
    .replace('Shift', '⇧')
    .replace('Alt', navigator.platform.includes('Mac') ? '⌥' : 'Alt');
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  binding: string
): boolean {
  const { modifiers, key } = parseShortcut(binding);
  const isMac = navigator.platform.includes('Mac');

  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const shiftPressed = event.shiftKey;
  const altPressed = event.altKey;

  // Check modifiers
  for (const modifier of modifiers) {
    if (modifier === 'Mod' && !modPressed) return false;
    if (modifier === 'Shift' && !shiftPressed) return false;
    if (modifier === 'Alt' && !altPressed) return false;
  }

  // Check key
  const eventKey = event.key.toLowerCase();
  const bindingKey = key.toLowerCase();

  return eventKey === bindingKey;
}

/**
 * Get the effective binding for a shortcut (custom or default)
 */
export function getEffectiveBinding(
  shortcutId: string,
  customBindings: Record<string, string>
): string {
  return customBindings[shortcutId] ||
    DEFAULT_SHORTCUTS.find(s => s.id === shortcutId)?.defaultBinding ||
    '';
}
