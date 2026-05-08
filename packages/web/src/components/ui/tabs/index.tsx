import clsx from "clsx";
import {
  type ButtonHTMLAttributes,
  createContext,
  type Dispatch,
  type HTMLAttributes,
  type KeyboardEvent,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./index.module.css";

export type TabsOrientation = "horizontal" | "vertical";

interface TabsContextValue {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly orientation: TabsOrientation;
  readonly listLabel?: string;
  readonly ensureTabIds: (value: string) => { tabId: string; panelId: string };
  readonly hasPanel: (value: string) => boolean;
  readonly registerPanel: Dispatch<string>;
  readonly unregisterPanel: Dispatch<string>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(componentName: string) {
  const context = useContext(TabsContext);

  if (!context) {
    throw new Error(`${componentName} must be used within Tabs`);
  }

  return context;
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly orientation?: TabsOrientation;
}

export function Tabs({
  children,
  className,
  orientation = "horizontal",
  value,
  onValueChange,
  "aria-label": ariaLabel,
  ...props
}: TabsProps) {
  const idPrefix = useId();
  const idsRef = useRef(new Map<string, { tabId: string; panelId: string }>());
  const [panelValues, setPanelValues] = useState<Record<string, true>>({});

  const ensureTabIds = useCallback(
    (tabValue: string) => {
      const existing = idsRef.current.get(tabValue);
      if (existing) {
        return existing;
      }

      const next = {
        tabId: `${idPrefix}-tab-${idsRef.current.size}`,
        panelId: `${idPrefix}-panel-${idsRef.current.size}`,
      };
      idsRef.current.set(tabValue, next);
      return next;
    },
    [idPrefix]
  );

  const registerPanel = useCallback((tabValue: string) => {
    setPanelValues((current) => {
      if (current[tabValue]) {
        return current;
      }

      return {
        ...current,
        [tabValue]: true,
      };
    });
  }, []);

  const unregisterPanel = useCallback((tabValue: string) => {
    setPanelValues((current) => {
      if (!current[tabValue]) {
        return current;
      }

      const next = { ...current };
      delete next[tabValue];
      return next;
    });
  }, []);

  const contextValue = useMemo<TabsContextValue>(
    () => ({
      value,
      onValueChange,
      orientation,
      listLabel: ariaLabel,
      ensureTabIds,
      hasPanel: (tabValue: string) => Boolean(panelValues[tabValue]),
      registerPanel,
      unregisterPanel,
    }),
    [
      ariaLabel,
      ensureTabIds,
      onValueChange,
      orientation,
      panelValues,
      registerPanel,
      unregisterPanel,
      value,
    ]
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div {...props} className={clsx(styles.tabs, className)} data-orientation={orientation}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  readonly orientation?: TabsOrientation;
}

export function TabList({ children, className, orientation, ...props }: TabListProps) {
  const tabs = useTabsContext("TabList");
  const resolvedOrientation = orientation ?? tabs.orientation;

  return (
    <div
      {...props}
      aria-label={props["aria-label"] ?? tabs.listLabel}
      aria-orientation={resolvedOrientation === "vertical" ? "vertical" : undefined}
      className={clsx(styles.tabList, className)}
      data-orientation={resolvedOrientation}
      role="tablist"
    >
      {children}
    </div>
  );
}

export interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly value: string;
}

export function Tab({ children, className, value, onClick, onKeyDown, ...props }: TabProps) {
  const tabs = useTabsContext("Tab");
  const selected = tabs.value === value;
  const ids = tabs.ensureTabIds(value);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    const tablist = event.currentTarget.closest('[role="tablist"]');
    if (!tablist) {
      return;
    }

    const resolvedOrientation =
      tablist.getAttribute("aria-orientation") === "vertical" ? "vertical" : "horizontal";

    const tabsInList = Array.from(
      tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)')
    );
    const currentIndex = tabsInList.indexOf(event.currentTarget);
    if (currentIndex === -1) {
      return;
    }

    const moveTo = (nextIndex: number) => {
      const nextTab = tabsInList[nextIndex];
      nextTab?.focus();
      const nextValue = nextTab?.dataset.value;
      if (nextValue) {
        tabs.onValueChange(nextValue);
      }
      event.preventDefault();
    };

    if (
      (resolvedOrientation === "horizontal" && event.key === "ArrowRight") ||
      (resolvedOrientation === "vertical" && event.key === "ArrowDown")
    ) {
      moveTo((currentIndex + 1) % tabsInList.length);
    } else if (
      (resolvedOrientation === "horizontal" && event.key === "ArrowLeft") ||
      (resolvedOrientation === "vertical" && event.key === "ArrowUp")
    ) {
      moveTo((currentIndex - 1 + tabsInList.length) % tabsInList.length);
    } else if (event.key === "Home") {
      moveTo(0);
    } else if (event.key === "End") {
      moveTo(tabsInList.length - 1);
    }
  };

  return (
    <button
      {...props}
      aria-controls={tabs.hasPanel(value) ? ids.panelId : undefined}
      aria-selected={selected}
      className={clsx(
        styles.tab,
        selected ? styles.tabActive : undefined,
        selected ? "active" : undefined,
        className
      )}
      data-state={selected ? "active" : "inactive"}
      data-value={value}
      id={ids.tabId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          tabs.onValueChange(value);
        }
      }}
      onKeyDown={handleKeyDown}
      role="tab"
      tabIndex={selected ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  readonly value: string;
}

export function TabPanel({ children, className, value, ...props }: TabPanelProps) {
  const tabs = useTabsContext("TabPanel");
  const selected = tabs.value === value;
  const ids = tabs.ensureTabIds(value);
  const { registerPanel, unregisterPanel } = tabs;

  useLayoutEffect(() => {
    registerPanel(value);

    return () => {
      unregisterPanel(value);
    };
  }, [registerPanel, unregisterPanel, value]);

  return (
    <div
      {...props}
      aria-labelledby={ids.tabId}
      className={clsx(styles.panel, className)}
      hidden={!selected}
      id={ids.panelId}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
