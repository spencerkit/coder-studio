/**
 * Keyboard Shortcuts Management (Phase 4)
 *
 * Centralized shortcut registry with customization support.
 */

import { atomWithStorage } from "jotai/utils";

export interface ShortcutDefinition {
  id: string;
  nameKey: string;
  descriptionKey: string;
  defaultBinding: string;
  category: "global" | "workspace" | "editor" | "terminal";
}

// Default shortcuts (PRD §5.2)
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Global
  {
    id: "command-palette.toggle",
    nameKey: "shortcuts.command_palette_toggle.name",
    descriptionKey: "shortcuts.command_palette_toggle.description",
    defaultBinding: "Mod+K",
    category: "global",
  },
  {
    id: "workspace.new",
    nameKey: "shortcuts.workspace_new.name",
    descriptionKey: "shortcuts.workspace_new.description",
    defaultBinding: "Mod+N",
    category: "global",
  },
  {
    id: "workspace.previous",
    nameKey: "shortcuts.workspace_previous.name",
    descriptionKey: "shortcuts.workspace_previous.description",
    defaultBinding: "Ctrl+Shift+ArrowLeft",
    category: "workspace",
  },
  {
    id: "workspace.next",
    nameKey: "shortcuts.workspace_next.name",
    descriptionKey: "shortcuts.workspace_next.description",
    defaultBinding: "Ctrl+Shift+ArrowRight",
    category: "workspace",
  },
  {
    id: "focus-mode.toggle",
    nameKey: "shortcuts.focus_mode_toggle.name",
    descriptionKey: "shortcuts.focus_mode_toggle.description",
    defaultBinding: "F",
    category: "global",
  },
  // Workspace
  {
    id: "agent.split-vertical",
    nameKey: "shortcuts.agent_split_vertical.name",
    descriptionKey: "shortcuts.agent_split_vertical.description",
    defaultBinding: "Mod+D",
    category: "workspace",
  },
  {
    id: "session.navigate.left",
    nameKey: "shortcuts.session_navigate_left.name",
    descriptionKey: "shortcuts.session_navigate_left.description",
    defaultBinding: "Ctrl+ArrowLeft",
    category: "workspace",
  },
  {
    id: "session.navigate.right",
    nameKey: "shortcuts.session_navigate_right.name",
    descriptionKey: "shortcuts.session_navigate_right.description",
    defaultBinding: "Ctrl+ArrowRight",
    category: "workspace",
  },
  {
    id: "session.navigate.up",
    nameKey: "shortcuts.session_navigate_up.name",
    descriptionKey: "shortcuts.session_navigate_up.description",
    defaultBinding: "Ctrl+ArrowUp",
    category: "workspace",
  },
  {
    id: "session.navigate.down",
    nameKey: "shortcuts.session_navigate_down.name",
    descriptionKey: "shortcuts.session_navigate_down.description",
    defaultBinding: "Ctrl+ArrowDown",
    category: "workspace",
  },
  {
    id: "agent.split-horizontal",
    nameKey: "shortcuts.agent_split_horizontal.name",
    descriptionKey: "shortcuts.agent_split_horizontal.description",
    defaultBinding: "Mod+Shift+D",
    category: "workspace",
  },
  // Editor
  {
    id: "editor.save",
    nameKey: "shortcuts.editor_save.name",
    descriptionKey: "shortcuts.editor_save.description",
    defaultBinding: "Mod+S",
    category: "editor",
  },
];

// Custom bindings stored in localStorage
export const customShortcutsAtom = atomWithStorage<Record<string, string>>(
  "ui.customShortcuts",
  {}
);

/**
 * Parse a shortcut binding string into modifiers and key
 */
export function parseShortcut(binding: string): {
  modifiers: string[];
  key: string;
} {
  const parts = binding.split("+");
  const key = parts.pop() || "";
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
    .replace("Mod", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")
    .replace("Ctrl", "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓");
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(event: KeyboardEvent, binding: string): boolean {
  const { modifiers, key } = parseShortcut(binding);
  const isMac = navigator.platform.includes("Mac");
  const expectedCtrl = modifiers.includes("Ctrl") || (!isMac && modifiers.includes("Mod"));
  const expectedMeta = isMac && modifiers.includes("Mod");
  const expectedShift = modifiers.includes("Shift");
  const expectedAlt = modifiers.includes("Alt");

  if (event.ctrlKey !== expectedCtrl) return false;
  if (event.metaKey !== expectedMeta) return false;
  if (event.shiftKey !== expectedShift) return false;
  if (event.altKey !== expectedAlt) return false;

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
  return (
    customBindings[shortcutId] ||
    DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)?.defaultBinding ||
    ""
  );
}
