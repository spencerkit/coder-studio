type WorkspacePendingLoadState = {
  pendingByPath: Record<string, number>;
  cancelledByPath: Record<string, number>;
};

const workspacePendingLoads = new Map<string, WorkspacePendingLoadState>();
const workspacePendingLoadListeners = new Map<string, Set<() => void>>();
let nextPendingEditorLoadRequestId = 0;

function getWorkspacePendingLoadState(workspaceId: string): WorkspacePendingLoadState {
  const existing = workspacePendingLoads.get(workspaceId);
  if (existing) {
    return existing;
  }

  const created: WorkspacePendingLoadState = {
    pendingByPath: {},
    cancelledByPath: {},
  };
  workspacePendingLoads.set(workspaceId, created);
  return created;
}

function cleanupWorkspacePendingLoadState(workspaceId: string, state: WorkspacePendingLoadState) {
  if (
    Object.keys(state.pendingByPath).length === 0 &&
    Object.keys(state.cancelledByPath).length === 0
  ) {
    workspacePendingLoads.delete(workspaceId);
  }
}

function notifyPendingEditorLoadListeners(workspaceId: string) {
  const listeners = workspacePendingLoadListeners.get(workspaceId);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

export function beginPendingEditorLoad(workspaceId: string, path: string): number {
  const state = getWorkspacePendingLoadState(workspaceId);
  const requestId = nextPendingEditorLoadRequestId + 1;
  nextPendingEditorLoadRequestId = requestId;
  delete state.cancelledByPath[path];
  state.pendingByPath[path] = requestId;
  notifyPendingEditorLoadListeners(workspaceId);
  return requestId;
}

export function shouldIgnorePendingEditorLoadResult(
  workspaceId: string,
  path: string,
  requestId: number
): boolean {
  const state = workspacePendingLoads.get(workspaceId);
  if (!state) {
    return true;
  }

  if (state.cancelledByPath[path] === requestId) {
    delete state.cancelledByPath[path];
    cleanupWorkspacePendingLoadState(workspaceId, state);
    return true;
  }

  return state.pendingByPath[path] !== requestId;
}

export function finishPendingEditorLoad(workspaceId: string, path: string, requestId: number) {
  const state = workspacePendingLoads.get(workspaceId);
  if (!state) {
    return;
  }

  if (state.pendingByPath[path] === requestId) {
    delete state.pendingByPath[path];
  }
  if (state.cancelledByPath[path] === requestId) {
    delete state.cancelledByPath[path];
  }

  cleanupWorkspacePendingLoadState(workspaceId, state);
  notifyPendingEditorLoadListeners(workspaceId);
}

export function cancelPendingEditorLoad(workspaceId: string, path: string) {
  const state = workspacePendingLoads.get(workspaceId);
  if (!state) {
    return;
  }

  const requestId = state.pendingByPath[path];
  if (requestId === undefined) {
    return;
  }

  state.cancelledByPath[path] = requestId;
  delete state.pendingByPath[path];
  notifyPendingEditorLoadListeners(workspaceId);
}

export function cancelAllPendingEditorLoads(workspaceId: string) {
  const state = workspacePendingLoads.get(workspaceId);
  if (!state) {
    return;
  }

  for (const [path, requestId] of Object.entries(state.pendingByPath)) {
    state.cancelledByPath[path] = requestId;
  }

  state.pendingByPath = {};
  notifyPendingEditorLoadListeners(workspaceId);
}

export function hasPendingEditorLoad(workspaceId: string, path: string): boolean {
  const state = workspacePendingLoads.get(workspaceId);
  return state?.pendingByPath[path] !== undefined;
}

export function hasAnyPendingEditorLoads(workspaceId: string): boolean {
  const state = workspacePendingLoads.get(workspaceId);
  return state !== undefined && Object.keys(state.pendingByPath).length > 0;
}

export function subscribeToPendingEditorLoads(workspaceId: string, listener: () => void) {
  const listeners = workspacePendingLoadListeners.get(workspaceId) ?? new Set<() => void>();
  listeners.add(listener);
  workspacePendingLoadListeners.set(workspaceId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      workspacePendingLoadListeners.delete(workspaceId);
    }
  };
}

export function __resetPendingEditorLoadsForTests() {
  workspacePendingLoads.clear();
  workspacePendingLoadListeners.clear();
  nextPendingEditorLoadRequestId = 0;
}

export function __getPendingEditorLoadWorkspaceCountForTests(): number {
  return workspacePendingLoads.size;
}
