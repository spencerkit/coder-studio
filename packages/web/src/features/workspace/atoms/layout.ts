/**
 * Workspace Layout State
 *
 * Workspace-scoped UI state for the workspace shell. The active-workspace
 * adapter atoms preserve existing consumers that operate on "the current
 * workspace" while the underlying storage is keyed by workspace id.
 */

import { atom, type Getter, type WritableAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { type AtomFamily, atomFamily } from "jotai-family";
import type { SetStateAction } from "react";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";

export type DesktopSidebarView =
  | "explorer"
  | "search"
  | "source-control"
  | "agent-instructions"
  | "skills";

export interface WorkspaceLayoutState {
  focusMode: boolean;
  leftPanelWidth: number;
  bottomPanelHeight: number;
  sidebarCollapsed: boolean;
  desktopSidebarView: DesktopSidebarView;
  terminalPanelVisible: boolean;
}

const GLOBAL_WORKSPACE_LAYOUT_ID = "__workspace_layout_global__";
const DEFAULT_DESKTOP_SIDEBAR_VIEW: DesktopSidebarView = "explorer";
const DESKTOP_SIDEBAR_VIEW_VALUES = new Set<DesktopSidebarView>([
  "explorer",
  "search",
  "source-control",
  "agent-instructions",
  "skills",
]);
const DEFAULT_WORKSPACE_LAYOUT_STATE: WorkspaceLayoutState = {
  focusMode: false,
  leftPanelWidth: 280,
  bottomPanelHeight: 200,
  sidebarCollapsed: false,
  desktopSidebarView: DEFAULT_DESKTOP_SIDEBAR_VIEW,
  terminalPanelVisible: true,
};

export function sanitizeDesktopSidebarView(value: unknown): DesktopSidebarView {
  return typeof value === "string" && DESKTOP_SIDEBAR_VIEW_VALUES.has(value as DesktopSidebarView)
    ? (value as DesktopSidebarView)
    : DEFAULT_DESKTOP_SIDEBAR_VIEW;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readLegacyStorageValue<T>(key: string): T | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function readLegacyWorkspaceLayoutState(): Partial<WorkspaceLayoutState> {
  return {
    focusMode: readLegacyStorageValue<boolean>("ui.focusMode"),
    leftPanelWidth: readLegacyStorageValue<number>("ui.leftPanelWidth"),
    bottomPanelHeight: readLegacyStorageValue<number>("ui.bottomPanelHeight"),
    sidebarCollapsed: readLegacyStorageValue<boolean>("ui.sidebarCollapsed"),
    desktopSidebarView: readLegacyStorageValue<DesktopSidebarView>("ui.desktopSidebarView"),
    terminalPanelVisible: readLegacyStorageValue<boolean>("ui.terminalPanelVisible"),
  };
}

function sanitizeWorkspaceLayoutState(
  value: unknown,
  fallback?: Partial<WorkspaceLayoutState>
): WorkspaceLayoutState {
  const candidate =
    value && typeof value === "object" ? (value as Partial<WorkspaceLayoutState>) : {};
  const base = {
    ...DEFAULT_WORKSPACE_LAYOUT_STATE,
    ...fallback,
  };

  return {
    focusMode: sanitizeBoolean(candidate.focusMode, base.focusMode),
    leftPanelWidth: sanitizePositiveNumber(candidate.leftPanelWidth, base.leftPanelWidth),
    bottomPanelHeight: sanitizePositiveNumber(candidate.bottomPanelHeight, base.bottomPanelHeight),
    sidebarCollapsed: sanitizeBoolean(candidate.sidebarCollapsed, base.sidebarCollapsed),
    desktopSidebarView: sanitizeDesktopSidebarView(
      candidate.desktopSidebarView ?? base.desktopSidebarView
    ),
    terminalPanelVisible: sanitizeBoolean(
      candidate.terminalPanelVisible,
      base.terminalPanelVisible
    ),
  };
}

const baseWorkspaceLayoutStorage = createJSONStorage<WorkspaceLayoutState>(
  () => window.localStorage
);
const workspaceLayoutStorage = {
  ...baseWorkspaceLayoutStorage,
  getItem: (key: string, initialValue: WorkspaceLayoutState) => {
    const fallback =
      typeof window !== "undefined" && window.localStorage.getItem(key) === null
        ? readLegacyWorkspaceLayoutState()
        : undefined;

    return sanitizeWorkspaceLayoutState(
      baseWorkspaceLayoutStorage.getItem(key, initialValue),
      fallback
    );
  },
  setItem: (key: string, value: WorkspaceLayoutState) =>
    baseWorkspaceLayoutStorage.setItem(key, sanitizeWorkspaceLayoutState(value)),
};

function resolveWorkspaceLayoutId(get: Getter): string {
  return get(resolvedActiveWorkspaceIdAtom) ?? GLOBAL_WORKSPACE_LAYOUT_ID;
}

function resolveNextValue<T>(current: T, update: SetStateAction<T>): T {
  return typeof update === "function" ? (update as (prevState: T) => T)(current) : update;
}

type WorkspaceLayoutFieldAtomFamily<Key extends keyof WorkspaceLayoutState> = AtomFamily<
  string,
  WritableAtom<WorkspaceLayoutState[Key], [update: SetStateAction<WorkspaceLayoutState[Key]>], void>
>;

function createWorkspaceLayoutFieldAtomFamily<Key extends keyof WorkspaceLayoutState>(
  field: Key
): WorkspaceLayoutFieldAtomFamily<Key> {
  return atomFamily((workspaceId: string) =>
    atom(
      (get) => get(workspaceLayoutStateAtomFamily(workspaceId))[field],
      (get, set, update: SetStateAction<WorkspaceLayoutState[Key]>) => {
        const currentState = get(workspaceLayoutStateAtomFamily(workspaceId));
        const nextValue = resolveNextValue(currentState[field], update);
        if (Object.is(nextValue, currentState[field])) {
          return;
        }

        set(workspaceLayoutStateAtomFamily(workspaceId), {
          ...currentState,
          [field]: nextValue,
        });
      }
    )
  );
}

function createActiveWorkspaceLayoutFieldAtom<Key extends keyof WorkspaceLayoutState>(
  family: WorkspaceLayoutFieldAtomFamily<Key>
): WritableAtom<
  WorkspaceLayoutState[Key],
  [update: SetStateAction<WorkspaceLayoutState[Key]>],
  void
> {
  return atom(
    (get) => get(family(resolveWorkspaceLayoutId(get))),
    (get, set, update: SetStateAction<WorkspaceLayoutState[Key]>) => {
      set(family(resolveWorkspaceLayoutId(get)), update);
    }
  );
}

export const workspaceLayoutStateAtomFamily = atomFamily((workspaceId: string) =>
  atomWithStorage<WorkspaceLayoutState>(
    `ui.workspaceLayout.${workspaceId}`,
    DEFAULT_WORKSPACE_LAYOUT_STATE,
    workspaceLayoutStorage,
    {
      getOnInit: true,
    }
  )
);

export const focusModeAtomFamily = createWorkspaceLayoutFieldAtomFamily("focusMode");
export const leftPanelWidthAtomFamily = createWorkspaceLayoutFieldAtomFamily("leftPanelWidth");
export const bottomPanelHeightAtomFamily =
  createWorkspaceLayoutFieldAtomFamily("bottomPanelHeight");
export const sidebarCollapsedAtomFamily = createWorkspaceLayoutFieldAtomFamily("sidebarCollapsed");
export const desktopSidebarViewAtomFamily =
  createWorkspaceLayoutFieldAtomFamily("desktopSidebarView");
export const terminalPanelVisibleAtomFamily =
  createWorkspaceLayoutFieldAtomFamily("terminalPanelVisible");

export const focusModeAtom = createActiveWorkspaceLayoutFieldAtom<"focusMode">(focusModeAtomFamily);
export const leftPanelWidthAtom =
  createActiveWorkspaceLayoutFieldAtom<"leftPanelWidth">(leftPanelWidthAtomFamily);
export const bottomPanelHeightAtom = createActiveWorkspaceLayoutFieldAtom<"bottomPanelHeight">(
  bottomPanelHeightAtomFamily
);
export const sidebarCollapsedAtom = createActiveWorkspaceLayoutFieldAtom<"sidebarCollapsed">(
  sidebarCollapsedAtomFamily
);
export const desktopSidebarViewAtom = createActiveWorkspaceLayoutFieldAtom<"desktopSidebarView">(
  desktopSidebarViewAtomFamily
);
export const terminalPanelVisibleAtom =
  createActiveWorkspaceLayoutFieldAtom<"terminalPanelVisible">(terminalPanelVisibleAtomFamily);
