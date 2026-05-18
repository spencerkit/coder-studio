import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "../../../../components/ui";
import { Portal } from "../../../../components/ui/_internal/portal";
import type {
  FileContextMenuItem,
  FileContextMenuSection,
} from "../../actions/use-file-context-actions";

interface AnchorPoint {
  x: number;
  y: number;
}

interface FileContextMenuProps {
  title: string;
  open: boolean;
  mode: "desktop" | "mobile";
  sections: FileContextMenuSection[];
  anchorPoint?: AnchorPoint | null;
  restoreFocusTo?: HTMLElement | null;
  onClose: () => void;
}

const VIEWPORT_PADDING = 8;

function getEnabledItems(sections: FileContextMenuSection[]) {
  return sections.flatMap((section) => section.items.filter((item) => !item.disabled));
}

function getNextEnabledItemId(
  items: FileContextMenuItem[],
  currentItemId: string | null,
  direction: 1 | -1
) {
  if (items.length === 0) {
    return null;
  }

  if (currentItemId === null) {
    return direction === 1 ? (items[0]?.id ?? null) : (items[items.length - 1]?.id ?? null);
  }

  const currentIndex = items.findIndex((item) => item.id === currentItemId);
  if (currentIndex === -1) {
    return direction === 1 ? (items[0]?.id ?? null) : (items[items.length - 1]?.id ?? null);
  }

  const nextIndex = currentIndex + direction;
  if (items[nextIndex]) {
    return items[nextIndex]!.id;
  }

  return direction === 1 ? (items[0]?.id ?? null) : (items[items.length - 1]?.id ?? null);
}

async function selectItem(item: FileContextMenuItem, onClose: () => void) {
  try {
    await item.onSelect();
  } catch (error) {
    console.error("File context menu action failed", error);
  } finally {
    onClose();
  }
}

function getMenuItemDomId(sectionId: string, itemId: string) {
  return `file-context-menu-item-${sectionId}-${itemId}`;
}

export function FileContextMenu({
  title,
  open,
  mode,
  sections,
  anchorPoint = null,
  restoreFocusTo = null,
  onClose,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousOpenRef = useRef(open);
  const restoreFocusTimerRef = useRef<number | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: VIEWPORT_PADDING, top: VIEWPORT_PADDING });
  const enabledItems = useMemo(() => getEnabledItems(sections), [sections]);
  const activeDescendantId = useMemo(() => {
    if (!activeItemId) {
      return undefined;
    }

    for (const section of sections) {
      const item = section.items.find((entry) => entry.id === activeItemId);
      if (item) {
        return getMenuItemDomId(section.id, item.id);
      }
    }

    return undefined;
  }, [activeItemId, sections]);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;

    if (open && !wasOpen) {
      setActiveItemId(null);
    }

    if (restoreFocusTimerRef.current !== null) {
      window.clearTimeout(restoreFocusTimerRef.current);
      restoreFocusTimerRef.current = null;
    }

    if (!open && wasOpen && restoreFocusTo?.isConnected) {
      restoreFocusTimerRef.current = window.setTimeout(() => {
        if (restoreFocusTo.isConnected) {
          restoreFocusTo.focus();
        }
        restoreFocusTimerRef.current = null;
      }, 0);
    }

    previousOpenRef.current = open;
  }, [open, restoreFocusTo]);

  useEffect(
    () => () => {
      if (restoreFocusTimerRef.current !== null) {
        window.clearTimeout(restoreFocusTimerRef.current);
      }
    },
    []
  );

  useLayoutEffect(() => {
    if (!open || mode !== "desktop" || !anchorPoint || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, anchorPoint.x),
      Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING)
    );
    const top = Math.min(
      Math.max(VIEWPORT_PADDING, anchorPoint.y),
      Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING)
    );

    setPosition({ left, top });
  }, [anchorPoint, mode, open, sections]);

  useLayoutEffect(() => {
    if (!open || mode !== "desktop") {
      return;
    }

    menuRef.current?.focus();
  }, [mode, open]);

  useEffect(() => {
    if (!open || mode !== "desktop") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (menuRef.current?.contains(event.target)) {
        return;
      }

      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [mode, onClose, open]);

  if (!open) {
    return null;
  }

  const handleMove = (direction: 1 | -1) => {
    const nextId = getNextEnabledItemId(enabledItems, activeItemId, direction);
    setActiveItemId(nextId);
  };

  const desktopMenu = (
    <div className="file-context-menu-layer">
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        aria-label={title}
        aria-orientation="vertical"
        aria-activedescendant={activeDescendantId}
        className="file-context-menu"
        style={{ position: "fixed", left: position.left, top: position.top }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            handleMove(1);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            handleMove(-1);
            return;
          }

          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          const activeItem = enabledItems.find((item) => item.id === activeItemId);
          if (!activeItem) {
            return;
          }

          event.preventDefault();
          void selectItem(activeItem, onClose);
        }}
      >
        {sections.map((section) => (
          <div key={section.id} className="file-context-menu__section">
            <h3 className="file-context-menu__section-title">{section.title}</h3>
            <div className="file-context-menu__section-items">
              {section.items.map((item) => (
                <button
                  key={item.id}
                  id={getMenuItemDomId(section.id, item.id)}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  data-active={activeItemId === item.id ? "true" : undefined}
                  className={clsx(
                    "file-context-menu__item",
                    item.tone === "danger" ? "file-context-menu__item--danger" : null
                  )}
                  onFocus={() => {
                    if (!item.disabled) {
                      setActiveItemId(item.id);
                    }
                  }}
                  onMouseEnter={() => {
                    if (!item.disabled) {
                      setActiveItemId(item.id);
                    }
                  }}
                  onClick={() => {
                    if (item.disabled) {
                      return;
                    }

                    void selectItem(item, onClose);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (mode === "mobile") {
    return (
      <Sheet
        title={title}
        onClose={onClose}
        body={
          <div className="file-context-menu__sheet">
            {sections.map((section) => (
              <section key={section.id} className="file-context-menu__sheet-section">
                <h3>{section.title}</h3>
                <div className="file-context-menu__sheet-actions">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={item.disabled}
                      className={clsx(
                        "file-context-menu__sheet-action",
                        item.tone === "danger" ? "file-context-menu__sheet-action--danger" : null
                      )}
                      onClick={() => {
                        if (item.disabled) {
                          return;
                        }

                        void selectItem(item, onClose);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        }
      />
    );
  }

  return <Portal>{desktopMenu}</Portal>;
}
