/**
 * Shortcuts Settings Component (Phase 4)
 *
 * UI for viewing and customizing keyboard shortcuts.
 */

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { Button, IconButton, Input, Kbd, SegmentedControl, Tooltip } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import {
  customShortcutsAtom,
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getEffectiveBinding,
} from "../../../lib/shortcuts";

type ShortcutCategory = "global" | "workspace" | "editor" | "terminal";

const CATEGORY_LABEL_KEYS: Record<ShortcutCategory, string> = {
  global: "settings.shortcuts.category_global",
  workspace: "settings.shortcuts.category_workspace",
  editor: "settings.shortcuts.category_editor",
  terminal: "settings.shortcuts.category_terminal",
};

export function ShortcutsSettings() {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const resetShortcutLabel = t("settings.shortcuts.reset_hint");
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
      const isArrowKey = event.key.startsWith("Arrow");

      const hasMacMod = isMac && event.metaKey;

      if (hasMacMod) {
        parts.push("Mod");
      }
      if (event.ctrlKey && isArrowKey) {
        parts.push("Ctrl");
      } else if (!isMac && event.ctrlKey) {
        parts.push("Mod");
      } else if (isMac && event.ctrlKey && !hasMacMod) {
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
      <SegmentedControl
        aria-label={t("settings.shortcuts.title")}
        className="shortcuts-category-tabs"
        onChange={(nextValue) => setActiveCategory(nextValue as ShortcutCategory)}
        optionClassName="shortcuts-category-tab"
        options={(Object.keys(CATEGORY_LABEL_KEYS) as ShortcutCategory[]).map((category) => ({
          label: t(CATEGORY_LABEL_KEYS[category]),
          value: category,
        }))}
        size="sm"
        value={activeCategory}
      />

      {/* Shortcuts List */}
      <div className="shortcuts-list">
        {shortcutsInCategory.map((shortcut) => {
          const binding = getEffectiveBinding(shortcut.id, customBindings);
          const isCustom = customBindings[shortcut.id] !== undefined;
          const isEditing = editingId === shortcut.id;
          const shortcutNameId = `shortcut-name-${shortcut.id}`;
          const shortcutDescriptionId = `shortcut-description-${shortcut.id}`;
          const shortcutName = t(shortcut.nameKey);
          const shortcutDescription = t(shortcut.descriptionKey);

          return (
            <div
              key={shortcut.id}
              className={`shortcuts-item ${isCustom ? "shortcuts-item-custom" : ""}`}
            >
              <div className="shortcuts-info">
                <span id={shortcutNameId} className="shortcuts-name">
                  {shortcutName}
                </span>
                <span id={shortcutDescriptionId} className="shortcuts-desc">
                  {shortcutDescription}
                </span>
              </div>

              <div className="shortcuts-binding">
                {isEditing ? (
                  <Input
                    ref={inputRef}
                    type="text"
                    className="shortcuts-capture"
                    aria-labelledby={shortcutNameId}
                    aria-describedby={shortcutDescriptionId}
                    placeholder={t("settings.shortcuts.capture_placeholder")}
                    autoFocus
                    onKeyDown={(e) => handleKeyCapture(e, shortcut.id)}
                    onBlur={() => setEditingId(null)}
                    readOnly
                  />
                ) : (
                  <>
                    <Kbd
                      className="shortcuts-key"
                      interactive
                      onClick={() => setEditingId(shortcut.id)}
                    >
                      {formatShortcut(binding)}
                    </Kbd>
                    {isCustom && (
                      <Tooltip content={resetShortcutLabel}>
                        <IconButton
                          aria-label={resetShortcutLabel}
                          icon="↺"
                          onClick={() => handleReset(shortcut.id)}
                          size="sm"
                        />
                      </Tooltip>
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
        <Button onClick={handleResetAll} variant="secondary">
          {t("settings.shortcuts.reset_all")}
        </Button>
      </div>
    </div>
  );
}
