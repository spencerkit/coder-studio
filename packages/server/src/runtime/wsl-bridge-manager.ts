export interface EnsureWslBridgePrerequisitesInput {
  distro: string;
  hostRuntimeVersion: string;
}

export interface ManagedWslNodeReadyState {
  nodeVersion: string;
  nodePath?: string;
}

export interface CreateWslBridgeInput extends EnsureWslBridgePrerequisitesInput {
  managedNode?: ManagedWslNodeReadyState;
}

export interface StopTrackedWslBridgeInput {
  reason: "host-runtime-updated" | "host-shutdown" | "runtime-version-mismatch";
  nextRuntimeVersion?: string;
}

export interface TrackedWslBridge {
  id: string;
  runtimeVersion: string;
  nodeVersion?: string;
  stop?(input?: StopTrackedWslBridgeInput): Promise<void>;
}

export interface WslBridgeManager {
  ensureBridgeForDistro(distro: string): Promise<TrackedWslBridge>;
  reconcileOnHostRuntimeUpdate(): Promise<void>;
  stopAllTrackedBridges(): Promise<void>;
  getTrackedBridge(distro: string): TrackedWslBridge | undefined;
}

export interface CreateWslBridgeManagerInput {
  createBridge(input: CreateWslBridgeInput): Promise<TrackedWslBridge>;
  getHostRuntimeVersion?(): string;
  ensureRuntimeVersion?(input: EnsureWslBridgePrerequisitesInput): Promise<void>;
  ensureManagedNode?(
    input: EnsureWslBridgePrerequisitesInput
  ): Promise<ManagedWslNodeReadyState | void>;
  stopBridge?(bridge: TrackedWslBridge, input: StopTrackedWslBridgeInput): Promise<void>;
}

function normalizeDistro(distro: string): string {
  const normalized = distro.trim();
  if (normalized.length === 0) {
    throw new Error("WSL distro is required");
  }
  return normalized;
}

function resolveHostRuntimeVersion(getHostRuntimeVersion?: () => string): string {
  const resolved = getHostRuntimeVersion?.().trim() ?? "";
  return resolved.length > 0 ? resolved : "0.0.0";
}

export function createWslBridgeManager(input: CreateWslBridgeManagerInput): WslBridgeManager {
  const trackedBridges = new Map<string, TrackedWslBridge>();
  const inFlightEnsures = new Map<string, Promise<TrackedWslBridge>>();
  const inFlightStops = new Map<string, Promise<void>>();
  let reconcilePromise: Promise<void> | undefined;
  let shutdownRequested = false;
  let shutdownPromise: Promise<void> | undefined;

  async function stopTrackedBridge(
    distro: string,
    bridge: TrackedWslBridge,
    stopInput: StopTrackedWslBridgeInput
  ): Promise<void> {
    const inFlightStop = inFlightStops.get(distro);
    if (inFlightStop) {
      return inFlightStop;
    }

    const stopPromise = (async () => {
      if (input.stopBridge) {
        await input.stopBridge(bridge, stopInput);
      } else {
        await bridge.stop?.(stopInput);
      }

      if (trackedBridges.get(distro) === bridge) {
        trackedBridges.delete(distro);
      }
    })();

    inFlightStops.set(distro, stopPromise);

    try {
      await stopPromise;
    } finally {
      if (inFlightStops.get(distro) === stopPromise) {
        inFlightStops.delete(distro);
      }
    }
  }

  async function waitForInFlightEnsures(): Promise<void> {
    if (inFlightEnsures.size === 0) {
      return;
    }

    await Promise.allSettled(Array.from(inFlightEnsures.values()));
  }

  async function createBridgeForDistro(distro: string): Promise<TrackedWslBridge> {
    const hostRuntimeVersion = resolveHostRuntimeVersion(input.getHostRuntimeVersion);
    const existingBridge = trackedBridges.get(distro);

    if (existingBridge && existingBridge.runtimeVersion === hostRuntimeVersion) {
      return existingBridge;
    }

    if (existingBridge) {
      await stopTrackedBridge(distro, existingBridge, {
        reason: "runtime-version-mismatch",
        nextRuntimeVersion: hostRuntimeVersion,
      });
    }

    const readinessInput = {
      distro,
      hostRuntimeVersion,
    };
    await input.ensureRuntimeVersion?.(readinessInput);
    const managedNodeReadyState = await input.ensureManagedNode?.(readinessInput);
    const managedNode = managedNodeReadyState ?? undefined;
    const bridge = await input.createBridge({
      ...readinessInput,
      managedNode,
    });

    if (bridge.runtimeVersion !== hostRuntimeVersion) {
      await stopTrackedBridge(distro, bridge, {
        reason: "runtime-version-mismatch",
        nextRuntimeVersion: hostRuntimeVersion,
      });
      throw new Error(
        `WSL bridge runtime version mismatch for distro ${distro}: expected ${hostRuntimeVersion}, got ${bridge.runtimeVersion}`
      );
    }

    trackedBridges.set(distro, bridge);
    return bridge;
  }

  async function ensureBridgeForDistro(distro: string): Promise<TrackedWslBridge> {
    if (shutdownRequested) {
      throw new Error("WSL bridge manager is shutting down");
    }

    const normalizedDistro = normalizeDistro(distro);
    const inFlight = inFlightEnsures.get(normalizedDistro);
    if (inFlight) {
      return inFlight;
    }

    const ensurePromise = createBridgeForDistro(normalizedDistro).finally(() => {
      inFlightEnsures.delete(normalizedDistro);
    });
    inFlightEnsures.set(normalizedDistro, ensurePromise);
    return ensurePromise;
  }

  return {
    async ensureBridgeForDistro(distro) {
      return ensureBridgeForDistro(distro);
    },

    async reconcileOnHostRuntimeUpdate() {
      if (shutdownRequested) {
        await shutdownPromise;
        return;
      }

      if (reconcilePromise) {
        return reconcilePromise;
      }

      const currentReconcile = (async () => {
        await waitForInFlightEnsures();

        const hostRuntimeVersion = resolveHostRuntimeVersion(input.getHostRuntimeVersion);
        for (const [distro, bridge] of Array.from(trackedBridges.entries())) {
          if (bridge.runtimeVersion === hostRuntimeVersion) {
            continue;
          }

          await stopTrackedBridge(distro, bridge, {
            reason: "host-runtime-updated",
            nextRuntimeVersion: hostRuntimeVersion,
          });
          await ensureBridgeForDistro(distro);
        }
      })();

      reconcilePromise = currentReconcile;

      try {
        await currentReconcile;
      } finally {
        if (reconcilePromise === currentReconcile) {
          reconcilePromise = undefined;
        }
      }
    },

    async stopAllTrackedBridges() {
      shutdownRequested = true;

      if (shutdownPromise) {
        return shutdownPromise;
      }

      const currentShutdown = (async () => {
        await waitForInFlightEnsures();

        let stopError: unknown;
        const trackedEntries = Array.from(trackedBridges.entries());

        await Promise.all(
          trackedEntries.map(async ([distro, bridge]) => {
            try {
              await stopTrackedBridge(distro, bridge, {
                reason: "host-shutdown",
              });
            } catch (error) {
              stopError ??= error;
            }
          })
        );

        if (stopError) {
          throw stopError;
        }
      })();

      shutdownPromise = currentShutdown;

      try {
        await currentShutdown;
      } finally {
        if (shutdownPromise === currentShutdown) {
          shutdownPromise = undefined;
        }
      }
    },

    getTrackedBridge(distro) {
      return trackedBridges.get(normalizeDistro(distro));
    },
  };
}
