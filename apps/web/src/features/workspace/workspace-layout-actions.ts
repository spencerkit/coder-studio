import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { XtermBaseHandle } from "../../components/terminal";
import {
  type SessionPaneNode,
  type Tab,
  type WorkbenchState,
  createId,
  createPaneLeaf,
} from "../../state/workbench-core";
import {
  collectPaneLeaves,
  findPaneIdBySessionId,
  findPaneSessionId,
  replacePaneNode,
  updateSplitRatio,
} from "../../shared/utils/panes";
type UpdateState = (updater: (current: WorkbenchState) => WorkbenchState) => void;
type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;

export const toggleWorkspaceRightPane = (
  current: WorkbenchState,
  pane: "code" | "terminal",
): WorkbenchState => ({
  ...current,
  layout: {
    ...current.layout,
    showCodePanel: pane === "code" ? !current.layout.showCodePanel : current.layout.showCodePanel,
    showTerminalPanel: pane === "terminal" ? !current.layout.showTerminalPanel : current.layout.showTerminalPanel,
  },
});

export const activateWorkspacePane = (
  updateTab: UpdateTab,
  tabId: string,
  paneId: string,
  sessionId: string,
) => {
  const nextActiveAt = Date.now();
  updateTab(tabId, (tab) => ({
    ...tab,
    activePaneId: paneId,
    activeSessionId: sessionId,
    sessions: tab.sessions.map((session) => {
      if (session.id === sessionId) {
          return {
            ...session,
            unread: 0,
            status: session.status,
            lastActiveAt: nextActiveAt,
          };
        }
      return session;
    }),
  }));
};

type SplitWorkspacePaneArgs = {
  tab: Tab;
  paneId: string;
  axis: "horizontal" | "vertical";
  updateTab: UpdateTab;
  createDraftSessionForTab: (tab: Tab, mode?: "branch" | "git_tree") => Tab["sessions"][number];
  onFocusPane: (paneId: string) => void;
};

export const splitWorkspacePane = ({
  tab,
  paneId,
  axis,
  updateTab,
  createDraftSessionForTab,
  onFocusPane,
}: SplitWorkspacePaneArgs) => {
  let nextPaneId: string | null = null;
  updateTab(tab.id, (currentTab) => {
    const targetPaneId = findPaneSessionId(currentTab.paneLayout, paneId)
      ? paneId
      : findPaneIdBySessionId(currentTab.paneLayout, currentTab.activeSessionId)
        ?? collectPaneLeaves(currentTab.paneLayout)[0]?.id;
    if (!targetPaneId) return currentTab;

    const newSession = createDraftSessionForTab(currentTab, "branch");
    const nextLeaf = createPaneLeaf(newSession.id);
    nextPaneId = nextLeaf.id;
    return {
      ...currentTab,
      sessions: [newSession, ...currentTab.sessions.filter((session) => session.id !== newSession.id)],
      activePaneId: nextLeaf.id,
      activeSessionId: newSession.id,
      paneLayout: replacePaneNode(currentTab.paneLayout, targetPaneId, (leaf) => ({
        type: "split",
        id: createId("split"),
        axis,
        ratio: 0.5,
        first: leaf,
        second: nextLeaf,
      })),
    };
  });

  if (nextPaneId) {
    onFocusPane(nextPaneId);
  }
};

type StartWorkspacePanelResizeArgs = {
  event: ReactPointerEvent;
  type: "left" | "right-split";
  stateRef: MutableRefObject<WorkbenchState>;
  updateState: UpdateState;
  shellTerminalRef: RefObject<XtermBaseHandle | null>;
  flushFitAgentTerminals: () => void;
};

export const startWorkspacePanelResize = ({
  event,
  type,
  stateRef,
  updateState,
  shellTerminalRef,
  flushFitAgentTerminals,
}: StartWorkspacePanelResizeArgs) => {
  event.preventDefault();
  document.body.classList.add("is-resizing-panels");
  document.body.classList.add(type === "right-split" ? "is-resizing-rows" : "is-resizing-columns");
  const startX = event.clientX;
  const startY = event.clientY;
  const { rightWidth, rightSplit } = stateRef.current.layout;
  const splitContainerHeight = type === "right-split"
    ? event.currentTarget instanceof HTMLElement
      ? event.currentTarget.parentElement?.getBoundingClientRect().height ?? 1
      : 1
    : 1;
  let frameId = 0;
  let pendingWidth = rightWidth;
  let pendingSplit = rightSplit;

  const flushLayout = () => {
    frameId = 0;
    updateState((current) => ({
      ...current,
      layout: {
        ...current.layout,
        rightWidth: type === "left" ? pendingWidth : current.layout.rightWidth,
        rightSplit: type === "right-split" ? pendingSplit : current.layout.rightSplit,
      },
    }));
  };

  const onMove = (moveEvent: PointerEvent) => {
    if (type === "left") {
      pendingWidth = Math.max(0, Math.round(rightWidth - (moveEvent.clientX - startX)));
    }
    if (type === "right-split") {
      const delta = moveEvent.clientY - startY;
      pendingSplit = Math.max(0, Math.min(100, rightSplit + (delta / splitContainerHeight) * 100));
    }
    if (!frameId) {
      frameId = window.requestAnimationFrame(flushLayout);
    }
  };

  const onUp = () => {
    document.body.classList.remove("is-resizing-panels");
    document.body.classList.remove("is-resizing-columns", "is-resizing-rows");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      flushLayout();
    }
    requestAnimationFrame(() => {
      shellTerminalRef.current?.fit();
      flushFitAgentTerminals();
    });
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
};

type StartWorkspacePaneSplitResizeArgs = {
  event: ReactPointerEvent<HTMLDivElement>;
  tabId: string;
  paneLayout: SessionPaneNode;
  splitId: string;
  axis: "horizontal" | "vertical";
  updateTab: UpdateTab;
  flushFitAgentTerminals: () => void;
};

export const startWorkspacePaneSplitResize = ({
  event,
  tabId,
  paneLayout,
  splitId,
  axis,
  updateTab,
  flushFitAgentTerminals,
}: StartWorkspacePaneSplitResizeArgs) => {
  event.preventDefault();
  document.body.classList.add("is-resizing-panels");
  document.body.classList.add(axis === "horizontal" ? "is-resizing-rows" : "is-resizing-columns");
  const container = event.currentTarget.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const readCurrentRatio = (node: SessionPaneNode): number | null => {
    if (node.type === "leaf") return null;
    if (node.id === splitId) return node.ratio;
    return readCurrentRatio(node.first) ?? readCurrentRatio(node.second);
  };

  const baseRatio = readCurrentRatio(paneLayout) ?? 0.5;
  let frameId = 0;
  let pendingRatio = baseRatio;

  const flushRatio = () => {
    frameId = 0;
    updateTab(tabId, (tab) => ({
      ...tab,
      paneLayout: updateSplitRatio(tab.paneLayout, splitId, pendingRatio),
    }));
  };

  const onMove = (moveEvent: PointerEvent) => {
    const delta = axis === "vertical"
      ? (moveEvent.clientX - startX) / Math.max(rect.width, 1)
      : (moveEvent.clientY - startY) / Math.max(rect.height, 1);
    pendingRatio = Math.max(0, Math.min(1, baseRatio + delta));
    if (!frameId) {
      frameId = window.requestAnimationFrame(flushRatio);
    }
  };

  const onUp = () => {
    document.body.classList.remove("is-resizing-panels");
    document.body.classList.remove("is-resizing-columns", "is-resizing-rows");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      flushRatio();
    }
    requestAnimationFrame(() => {
      flushFitAgentTerminals();
    });
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
};
