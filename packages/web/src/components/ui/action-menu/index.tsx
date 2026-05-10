import clsx from "clsx";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isEscapeKey } from "../_internal/dismiss";
import { restoreFocus } from "../_internal/focus-trap";
import { Portal } from "../_internal/portal";
import { useViewport } from "../_internal/use-viewport";
import { Sheet } from "../sheet";
import styles from "./index.module.css";

export type ActionMenuForceMode = "auto" | "desktop" | "mobile";
export type ActionMenuPlacement = "bottom-start" | "bottom-end";
export type ActionMenuItemTone = "default" | "danger";

export interface ActionMenuItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: ActionMenuItemTone;
  readonly disabled?: boolean;
  readonly onSelect: () => void | Promise<void>;
}

type TriggerProps = {
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu";
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

interface Position {
  readonly left: number;
  readonly top: number;
  readonly visibility: "hidden" | "visible";
}

export interface ActionMenuProps {
  readonly children: ReactElement;
  readonly items: readonly ActionMenuItem[];
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly forceMode?: ActionMenuForceMode;
  readonly placement?: ActionMenuPlacement;
  readonly contentClassName?: string;
  readonly sheetBodyClassName?: string;
}

const VIEWPORT_PADDING = 8;
const CONTENT_OFFSET = 8;

function isTriggerElement(child: unknown): child is ReactElement<TriggerProps> {
  return isValidElement(child);
}

function getEnabledItemIndexes(items: readonly ActionMenuItem[]) {
  return items.reduce<number[]>((indexes, item, index) => {
    if (!item.disabled) {
      indexes.push(index);
    }

    return indexes;
  }, []);
}

function getNextEnabledIndex(
  items: readonly ActionMenuItem[],
  currentIndex: number | null,
  direction: 1 | -1
) {
  const enabledIndexes = getEnabledItemIndexes(items);
  if (enabledIndexes.length === 0) {
    return null;
  }

  if (currentIndex === null) {
    return direction === 1
      ? (enabledIndexes[0] ?? null)
      : (enabledIndexes[enabledIndexes.length - 1] ?? null);
  }

  const currentEnabledIndex = enabledIndexes.indexOf(currentIndex);
  if (currentEnabledIndex === -1) {
    return direction === 1
      ? (enabledIndexes[0] ?? null)
      : (enabledIndexes[enabledIndexes.length - 1] ?? null);
  }

  const nextEnabledIndex = enabledIndexes[currentEnabledIndex + direction];
  if (nextEnabledIndex !== undefined) {
    return nextEnabledIndex;
  }

  return direction === 1
    ? (enabledIndexes[0] ?? null)
    : (enabledIndexes[enabledIndexes.length - 1] ?? null);
}

export function ActionMenu({
  children,
  items,
  title,
  open,
  onOpenChange,
  forceMode = "auto",
  placement = "bottom-start",
  contentClassName,
  sheetBodyClassName,
}: ActionMenuProps) {
  const viewport = useViewport();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusRef = useRef<Element | null>(null);
  const contentId = useId();
  const resolvedMode =
    forceMode === "desktop" ? "desktop" : forceMode === "mobile" ? "mobile" : viewport;
  const desktopOpen = open && resolvedMode === "desktop";
  const mobileOpen = open && resolvedMode === "mobile";
  const [position, setPosition] = useState<Position>({
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
    visibility: "hidden",
  });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const child = Children.only(children);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement;

    return () => {
      restoreFocus(restoreFocusRef.current);
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(null);
      return;
    }

    setActiveIndex((current) => {
      if (current !== null && items[current] && !items[current]?.disabled) {
        return current;
      }

      return getNextEnabledIndex(items, current, 1);
    });
  }, [items, open]);

  useLayoutEffect(() => {
    if (!desktopOpen || !triggerRef.current || !menuRef.current) {
      setPosition((current) =>
        current.visibility === "hidden"
          ? current
          : {
              ...current,
              visibility: "hidden",
            }
      );
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current || !menuRef.current) {
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const preferredLeft =
        placement === "bottom-end" ? triggerRect.right - menuRect.width : triggerRect.left;
      const maxLeft = Math.max(
        VIEWPORT_PADDING,
        window.innerWidth - menuRect.width - VIEWPORT_PADDING
      );
      const left = Math.min(maxLeft, Math.max(VIEWPORT_PADDING, preferredLeft));
      const bottomTop = triggerRect.bottom + CONTENT_OFFSET;
      const top =
        bottomTop + menuRect.height <= window.innerHeight - VIEWPORT_PADDING
          ? bottomTop
          : Math.max(VIEWPORT_PADDING, triggerRect.top - menuRect.height - CONTENT_OFFSET);

      setPosition({
        left,
        top,
        visibility: "visible",
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [desktopOpen, placement]);

  useLayoutEffect(() => {
    if (!desktopOpen || activeIndex === null) {
      return;
    }

    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, desktopOpen]);

  useEffect(() => {
    if (!desktopOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) {
        return;
      }

      onOpenChange(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isEscapeKey(event)) {
        return;
      }

      event.preventDefault();
      onOpenChange(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [desktopOpen, onOpenChange]);

  if (!isTriggerElement(child)) {
    throw new Error("ActionMenu requires a single trigger React element.");
  }

  const handleItemSelect = async (item: ActionMenuItem) => {
    if (item.disabled) {
      return;
    }

    onOpenChange(false);
    await Promise.resolve();
    await item.onSelect();
  };

  const renderedTrigger = cloneElement(child, {
    "aria-controls": desktopOpen ? contentId : undefined,
    "aria-expanded": open,
    "aria-haspopup": "menu",
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      child.props.onClick?.(event);
      if (!event.defaultPrevented) {
        onOpenChange(!open);
      }
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      child.props.onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) {
          setActiveIndex(getNextEnabledIndex(items, null, 1));
          onOpenChange(true);
          return;
        }

        setActiveIndex((current) => getNextEnabledIndex(items, current, 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) {
          setActiveIndex(getNextEnabledIndex(items, null, -1));
          onOpenChange(true);
          return;
        }

        setActiveIndex((current) => getNextEnabledIndex(items, current, -1));
        return;
      }

      if ((event.key === "Enter" || event.key === " ") && !open) {
        event.preventDefault();
        setActiveIndex(getNextEnabledIndex(items, null, 1));
        onOpenChange(true);
        return;
      }

      if (isEscapeKey(event) && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    },
  });

  const menuContent = (
    <div className={styles.menu} id={contentId} role="menu" aria-label={title}>
      {items.map((item, index) => {
        const tone = item.tone ?? "default";

        return (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            className={clsx(
              styles.item,
              tone === "danger" ? styles.itemDanger : null,
              item.disabled ? styles.itemDisabled : null
            )}
            disabled={item.disabled}
            onClick={() => {
              void handleItemSelect(item);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => getNextEnabledIndex(items, current, 1));
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => getNextEnabledIndex(items, current, -1));
                return;
              }

              if ((event.key === "Enter" || event.key === " ") && !item.disabled) {
                event.preventDefault();
                void handleItemSelect(item);
                return;
              }

              if (isEscapeKey(event)) {
                event.preventDefault();
                event.stopPropagation();
                onOpenChange(false);
              }
            }}
            role="menuitem"
            tabIndex={activeIndex === index ? 0 : -1}
          >
            {item.icon ? <span className={styles.itemIcon}>{item.icon}</span> : null}
            <span className={styles.itemLabel}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <span className={styles.triggerWrapper} ref={triggerRef}>
        {renderedTrigger}
      </span>

      {desktopOpen ? (
        <Portal>
          <div
            className={clsx(styles.content, contentClassName)}
            ref={menuRef}
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              visibility: position.visibility,
            }}
          >
            {menuContent}
          </div>
        </Portal>
      ) : null}

      {mobileOpen ? (
        <Sheet
          title={title}
          body={menuContent}
          bodyClassName={clsx("mobile-sheet__body--flush", sheetBodyClassName)}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </>
  );
}
