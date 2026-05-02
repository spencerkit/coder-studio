export type HydrationTier = 'focused' | 'visible-active' | 'visible-other' | 'background';

export interface HydrationRequest {
  terminalId: string;
  tier: HydrationTier;
}

export interface HydrationInspectionEntry {
  terminalId: string;
  tier: HydrationTier;
  queuePosition: number;
}

export interface HydrationRequestHandle {
  granted: Promise<void>;
  isGranted: boolean;
  promote: (tier: HydrationTier) => void;
  release: () => void;
  subscribePosition: (callback: (position: number) => void) => () => void;
}

export interface HydrationCoordinator {
  request: (req: HydrationRequest) => HydrationRequestHandle;
  inspect: () => { running: string[]; queued: HydrationInspectionEntry[] };
}

interface InternalRequest {
  terminalId: string;
  tier: HydrationTier;
  granted: Promise<void>;
  resolveGranted: () => void;
  grantedResolved: boolean;
  running: boolean;
  positionListeners: Set<(position: number) => void>;
  handle: HydrationRequestHandle;
}

const DEFAULT_CONCURRENCY = 2;
const TIER_PRIORITY: Record<HydrationTier, number> = {
  focused: 0,
  'visible-active': 1,
  'visible-other': 2,
  background: 3,
};

function compareTier(left: HydrationTier, right: HydrationTier) {
  return TIER_PRIORITY[left] - TIER_PRIORITY[right];
}

export function createHydrationCoordinator(
  options?: { concurrency?: number }
): HydrationCoordinator {
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY);
  const running = new Map<string, InternalRequest>();
  const queued: InternalRequest[] = [];
  const requests = new Map<string, InternalRequest>();

  const notifyQueuePositions = () => {
    queued.forEach((entry, index) => {
      for (const listener of entry.positionListeners) {
        listener(index);
      }
    });
  };

  const pump = () => {
    while (running.size < concurrency && queued.length > 0) {
      const next = queued.shift();
      if (!next) {
        break;
      }

      next.running = true;
      running.set(next.terminalId, next);
      next.handle.isGranted = true;
      if (!next.grantedResolved) {
        next.grantedResolved = true;
        next.resolveGranted();
      }
    }

    notifyQueuePositions();
  };

  const removeFromQueue = (terminalId: string) => {
    const index = queued.findIndex((entry) => entry.terminalId === terminalId);
    if (index >= 0) {
      queued.splice(index, 1);
      notifyQueuePositions();
      return true;
    }

    return false;
  };

  const release = (entry: InternalRequest) => {
    const queuedRemoved = removeFromQueue(entry.terminalId);
    const runningRemoved = running.delete(entry.terminalId);
    if (!queuedRemoved && !runningRemoved) {
      return;
    }

    requests.delete(entry.terminalId);
    if (runningRemoved) {
      pump();
    }
  };

  const promote = (entry: InternalRequest, tier: HydrationTier) => {
    entry.tier = tier;
    if (entry.running) {
      return;
    }

    const index = queued.findIndex((candidate) => candidate.terminalId === entry.terminalId);
    if (index < 0) {
      return;
    }

    queued.splice(index, 1);

    let insertIndex = queued.findIndex((candidate) => compareTier(tier, candidate.tier) < 0);
    if (insertIndex < 0) {
      insertIndex = queued.length;
    }

    queued.splice(insertIndex, 0, entry);
    pump();
  };

  const enqueue = (entry: InternalRequest) => {
    let insertIndex = queued.findIndex((candidate) => compareTier(entry.tier, candidate.tier) < 0);
    if (insertIndex < 0) {
      insertIndex = queued.length;
    }
    queued.splice(insertIndex, 0, entry);
    pump();
  };

  return {
    request(req) {
      const existing = requests.get(req.terminalId);
      if (existing) {
        if (compareTier(req.tier, existing.tier) < 0) {
          promote(existing, req.tier);
        }
        return existing.handle;
      }

      let resolveGranted = () => {};
      const granted = new Promise<void>((resolve) => {
        resolveGranted = resolve;
      });

      const entry = {} as InternalRequest;
      entry.terminalId = req.terminalId;
      entry.tier = req.tier;
      entry.granted = granted;
      entry.resolveGranted = resolveGranted;
      entry.grantedResolved = false;
      entry.running = false;
      entry.positionListeners = new Set();
      entry.handle = {
        granted,
        isGranted: false,
        promote: (tier) => promote(entry, tier),
        release: () => release(entry),
        subscribePosition: (callback) => {
          entry.positionListeners.add(callback);
          const index = queued.findIndex((candidate) => candidate.terminalId === entry.terminalId);
          if (index >= 0) {
            callback(index);
          }

          return () => {
            entry.positionListeners.delete(callback);
          };
        },
      };

      requests.set(req.terminalId, entry);

      if (running.size < concurrency) {
        entry.running = true;
        running.set(entry.terminalId, entry);
        entry.handle.isGranted = true;
        entry.grantedResolved = true;
        entry.resolveGranted();
      } else {
        enqueue(entry);
      }

      return entry.handle;
    },
    inspect() {
      return {
        running: Array.from(running.keys()),
        queued: queued.map((entry, index) => ({
          terminalId: entry.terminalId,
          tier: entry.tier,
          queuePosition: index,
        })),
      };
    },
  };
}

export const globalHydrationCoordinator = createHydrationCoordinator();
