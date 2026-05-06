/**
 * Shortcuts Settings Component (Phase 4)
 *
 * UI for viewing and customizing keyboard shortcuts.
 */

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import {
  customShortcutsAtom,
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getEffectiveBinding,
} from "../../../lib/shortcuts";

type ShortcutCategory = "global" | "workspace" | "editor" | "terminal";

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  global: "全局",
  workspace: "工作区",
  editor: "编辑器",
  terminal: "终端",
};

export function ShortcutsSettings() {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [customBindings, setCustomBindings] = useAtom(customShortcutsAtom);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ShortcutCategory>("global");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  const handleKeyCapture = useCallback(
    (event: React.KeyboardEvent, shortcutId: string) => {
      event.preventDefault();
      event.stopPropagation();

      // Build binding string
      const parts: string[] = [];
      const isMac = navigator.platform.includes("Mac");

      if (isMac ? event.metaKey : event.ctrlKey) {
        parts.push("Mod");
      }
      if (event.shiftKey) {
        parts.push("Shift");
      }
      if (event.altKey) {
        parts.push("Alt");
      }

      // Add the key
      if (event.key.length === 1) {
        parts.push(event.key.toUpperCase());
      } else if (event.key === "Escape") {
        // Cancel editing
        setEditingId(null);
        return;
      } else {
        parts.push(event.key);
      }

      const binding = parts.join("+");

      // Update custom bindings
      setCustomBindings((prev) => ({
        ...prev,
        [shortcutId]: binding,
      }));

      // Save to settings
      void dispatch("settings.update", {
        settings: { shortcuts: { [shortcutId]: binding } },
      });

      setEditingId(null);
    },
    [setCustomBindings, dispatch]
  );

  const handleReset = useCallback(
    (shortcutId: string) => {
      setCustomBindings((prev) => {
        const next = { ...prev };
        delete next[shortcutId];
        return next;
      });

      void dispatch("settings.update", {
        settings: { shortcuts: { [shortcutId]: null } },
      });
    },
    [setCustomBindings, dispatch]
  );

  const handleResetAll = useCallback(() => {
    setCustomBindings({});
    void dispatch("settings.update", {
      settings: { shortcuts: {} },
    });
  }, [setCustomBindings, dispatch]);

  const shortcutsInCategory = DEFAULT_SHORTCUTS.filter((s) => s.category === activeCategory);

  return (
    <div className="settings-section">
      {/* Category Tabs */}
      <div className="shortcuts-category-tabs">
        {(Object.keys(CATEGORY_LABELS) as ShortcutCategory[]).map((category) => (
          <button
            key={category}
            className={`shortcuts-category-tab ${activeCategory === category ? "active" : ""}`}
            onClick={() => setActiveCategory(category)}
          >
            {CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      {/* Shortcuts List */}
      <div className="shortcuts-list">
        {shortcutsInCategory.map((shortcut) => {
          const binding = getEffectiveBinding(shortcut.id, customBindings);
          const isCustom = customBindings[shortcut.id] !== undefined;
          const isEditing = editingId === shortcut.id;

          return (
            <div
              key={shortcut.id}
              className={`shortcuts-item ${isCustom ? "shortcuts-item-custom" : ""}`}
            >
              <div className="shortcuts-info">
                <span className="shortcuts-name">{shortcut.name}</span>
                <span className="shortcuts-desc">{shortcut.description}</span>
              </div>

              <div className="shortcuts-binding">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    type="text"
                    className="input shortcuts-capture"
                    placeholder="按下快捷键..."
                    onKeyDown={(e) => handleKeyCapture(e, shortcut.id)}
                    onBlur={() => setEditingId(null)}
                    readOnly
                  />
                ) : (
                  <>
                    <kbd className="shortcuts-key" onClick={() => setEditingId(shortcut.id)}>
                      {formatShortcut(binding)}
                    </kbd>
                    {isCustom && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleReset(shortcut.id)}
                        title="重置为默认"
                      >
                        ↺
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reset All */}
      <div className="shortcuts-footer">
        <button className="btn btn-secondary" onClick={handleResetAll}>
          {t("settings.shortcuts.reset_all")}
        </button>
      </div>
    </div>
  );
}
