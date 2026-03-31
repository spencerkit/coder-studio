type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

type ScheduledEntry<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timer: TimeoutHandle | null;
};

const createDeferred = <T,>(): Omit<ScheduledEntry<T>, "timer"> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve,
    reject,
  };
};

export const createWorkspaceArtifactRefreshQueue = <T,>(
  runRefresh: (tabId: string) => Promise<T>,
  scheduleTimeout: (callback: () => void, delayMs: number) => TimeoutHandle,
  cancelTimeout: (handle: TimeoutHandle) => void,
  delayMs: number,
) => {
  const pending = new Map<string, Promise<T>>();
  const scheduled = new Map<string, ScheduledEntry<T>>();

  const settleScheduledEntry = (tabId: string, entry: ScheduledEntry<T>) => {
    const task = Promise.resolve().then(() => runRefresh(tabId));
    pending.set(tabId, task);
    task.then(entry.resolve, entry.reject).finally(() => {
      pending.delete(tabId);
      if (scheduled.get(tabId) === entry) {
        scheduled.delete(tabId);
      }
    });
    return entry.promise;
  };

  const flush = (tabId: string): Promise<T> | null => {
    const inflight = pending.get(tabId);
    if (inflight) {
      return inflight;
    }

    const entry = scheduled.get(tabId);
    if (!entry) {
      return null;
    }

    if (entry.timer !== null) {
      cancelTimeout(entry.timer);
      entry.timer = null;
    }
    return settleScheduledEntry(tabId, entry);
  };

  const request = (tabId: string, immediate = false): Promise<T> => {
    if (immediate) {
      return flush(tabId) ?? Promise.resolve().then(() => runRefresh(tabId));
    }

    const inflight = pending.get(tabId);
    if (inflight) {
      return inflight;
    }

    const existing = scheduled.get(tabId);
    if (existing) {
      return existing.promise;
    }

    const entry: ScheduledEntry<T> = {
      ...createDeferred<T>(),
      timer: null,
    };
    entry.timer = scheduleTimeout(() => {
      entry.timer = null;
      void settleScheduledEntry(tabId, entry);
    }, delayMs);
    scheduled.set(tabId, entry);
    return entry.promise;
  };

  const dispose = (tabId?: string) => {
    const tabIds = tabId ? [tabId] : [...scheduled.keys()];
    for (const currentTabId of tabIds) {
      const entry = scheduled.get(currentTabId);
      if (!entry) continue;
      if (entry.timer !== null) {
        cancelTimeout(entry.timer);
      }
      entry.reject(new Error("workspace_artifact_refresh_queue_disposed"));
      scheduled.delete(currentTabId);
    }
  };

  return {
    request,
    flush,
    dispose,
  };
};
