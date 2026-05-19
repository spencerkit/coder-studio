import type {
  ProviderInstallFailure,
  ProviderInstallJobSnapshot,
  ProviderRuntimeStatusEntry,
  ProviderRuntimeStatusResponse,
  Session,
} from "@coder-studio/core";
import { useEffect, useRef, useState } from "react";
import type { DispatchCommand } from "../../../atoms/connection";

export type ProviderId = "claude" | "codex";

export interface ProviderCardState {
  runtime?: ProviderRuntimeStatusEntry;
  installJob?: ProviderInstallJobSnapshot;
  loading: boolean;
  inlineError?: string;
}

interface UseProviderLauncherResult {
  states: Record<ProviderId, ProviderCardState>;
  launch: (providerId: ProviderId) => Promise<void>;
}

function canAutoInstall(runtime: ProviderRuntimeStatusEntry): boolean {
  return runtime.autoInstallSupported && runtime.installReadiness === "ready";
}

function createFallbackRuntimeEntry(providerId: ProviderId): ProviderRuntimeStatusEntry {
  return {
    providerId,
    available: true,
    missingCommands: [],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: "ready",
    manualGuideKeys: [],
    docUrls: {
      provider: "",
      prerequisites: {},
    },
  };
}

function buildStateMap(
  providers?: ProviderRuntimeStatusResponse["providers"]
): Record<ProviderId, ProviderCardState> {
  return {
    claude: {
      runtime: providers?.claude ?? createFallbackRuntimeEntry("claude"),
      loading: false,
    },
    codex: {
      runtime: providers?.codex ?? createFallbackRuntimeEntry("codex"),
      loading: false,
    },
  };
}

export function useProviderLauncher(
  dispatch: DispatchCommand,
  workspaceId: string,
  onSessionCreated: (session: Session, providerId: ProviderId) => void,
  _continuation?: { paneId?: string; launchMode?: "assign" | "replace" }
): UseProviderLauncherResult {
  const [states, setStates] = useState<Record<ProviderId, ProviderCardState>>(buildStateMap());
  const pollingTimers = useRef<Partial<Record<ProviderId, number>>>({});

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      const result = await dispatch<ProviderRuntimeStatusResponse>("provider.runtimeStatus", {});
      if (cancelled) {
        return;
      }

      if (!result.ok || !result.data) {
        setStates((prev) => ({
          claude: { ...prev.claude, ...buildStateMap().claude },
          codex: { ...prev.codex, ...buildStateMap().codex },
        }));
        return;
      }

      const nextStates = buildStateMap(result.data.providers);

      setStates((prev) => ({
        claude: {
          ...prev.claude,
          ...nextStates.claude,
        },
        codex: {
          ...prev.codex,
          ...nextStates.codex,
        },
      }));
    };

    void loadStatus();

    return () => {
      cancelled = true;
      for (const timer of Object.values(pollingTimers.current)) {
        if (typeof timer === "number") {
          window.clearTimeout(timer);
        }
      }
    };
  }, [dispatch]);

  const refreshStatus = async (): Promise<void> => {
    const result = await dispatch<ProviderRuntimeStatusResponse>("provider.runtimeStatus", {});
    if (!result.ok || !result.data) {
      return;
    }

    const nextStates = buildStateMap(result.data.providers);

    setStates((prev) => ({
      claude: {
        ...prev.claude,
        runtime: nextStates.claude.runtime,
        loading: false,
      },
      codex: {
        ...prev.codex,
        runtime: nextStates.codex.runtime,
        loading: false,
      },
    }));
  };

  const updateFailureState = (
    providerId: ProviderId,
    failure: ProviderInstallFailure | undefined,
    inlineError?: string
  ) => {
    setStates((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        loading: false,
        inlineError,
        installJob: prev[providerId].installJob
          ? {
              ...prev[providerId].installJob!,
              failure,
            }
          : prev[providerId].installJob,
      },
    }));
  };

  const handleSessionCreateFailure = async (
    providerId: ProviderId,
    message?: string,
    code?: string
  ) => {
    if (code === "provider_cli_missing") {
      await refreshStatus();
    }

    setStates((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        loading: false,
        inlineError: message,
      },
    }));
  };

  const launch = async (providerId: ProviderId): Promise<void> => {
    const runtime = states[providerId].runtime;
    if (!runtime) {
      return;
    }

    setStates((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        loading: true,
        inlineError: undefined,
      },
    }));

    if (runtime.available) {
      const createResult = await dispatch<Session>("session.create", {
        workspaceId,
        providerId,
      });

      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
        setStates((prev) => ({
          ...prev,
          [providerId]: {
            ...prev[providerId],
            loading: false,
          },
        }));
        return;
      }

      await handleSessionCreateFailure(
        providerId,
        createResult.error?.message,
        createResult.error?.code
      );
      return;
    }

    if (!canAutoInstall(runtime)) {
      setStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          loading: false,
          inlineError: "manual",
        },
      }));
      return;
    }

    const startResult = await dispatch<ProviderInstallJobSnapshot>("provider.install.start", {
      providerId,
    });

    if (!startResult.ok || !startResult.data) {
      setStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          loading: false,
          inlineError: startResult.error?.message,
        },
      }));
      return;
    }

    setStates((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        installJob: startResult.data,
        loading: false,
      },
    }));

    if (startResult.data.status === "failed") {
      updateFailureState(providerId, startResult.data.failure, startResult.data.failure?.message);
      return;
    }

    if (startResult.data.status === "succeeded") {
      await refreshStatus();
      const createResult = await dispatch<Session>("session.create", {
        workspaceId,
        providerId,
      });

      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
      }
      if (!createResult.ok) {
        await handleSessionCreateFailure(
          providerId,
          createResult.error?.message,
          createResult.error?.code
        );
      }
      return;
    }

    const poll = async () => {
      const jobResult = await dispatch<ProviderInstallJobSnapshot>("provider.install.get", {
        jobId: startResult.data!.jobId,
      });

      if (!jobResult.ok || !jobResult.data) {
        setStates((prev) => ({
          ...prev,
          [providerId]: {
            ...prev[providerId],
            loading: false,
            inlineError: jobResult.error?.message,
          },
        }));
        return;
      }

      setStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          installJob: jobResult.data,
          loading: false,
          inlineError: undefined,
        },
      }));

      if (jobResult.data.status === "queued" || jobResult.data.status === "running") {
        pollingTimers.current[providerId] = window.setTimeout(poll, 1500);
        return;
      }

      if (jobResult.data.status === "failed") {
        updateFailureState(providerId, jobResult.data.failure, jobResult.data.failure?.message);
        return;
      }

      await refreshStatus();
      const createResult = await dispatch<Session>("session.create", {
        workspaceId,
        providerId,
      });

      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
        return;
      }

      await handleSessionCreateFailure(
        providerId,
        createResult.error?.message,
        createResult.error?.code
      );
    };

    pollingTimers.current[providerId] = window.setTimeout(poll, 1500);
  };

  return { states, launch };
}
