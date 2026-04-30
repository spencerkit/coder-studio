import { useEffect, useRef, useState } from 'react';
import type {
  ProviderInstallFailure,
  ProviderInstallJobSnapshot,
  ProviderRuntimeStatusEntry,
  ProviderRuntimeStatusResponse,
  Session,
} from '@coder-studio/core';
import type { DispatchCommand } from '../../atoms/connection';

export type ProviderId = 'claude' | 'codex';

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

function createFallbackRuntimeEntry(providerId: ProviderId): ProviderRuntimeStatusEntry {
  return {
    providerId,
    available: true,
    missingCommands: [],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: 'ready',
    manualGuideKeys: [],
    docUrls: {
      provider: '',
      prerequisites: {},
    },
  };
}

function buildStateMap(
  providers?: ProviderRuntimeStatusResponse['providers'],
): Record<ProviderId, ProviderCardState> {
  return {
    claude: {
      runtime: providers?.claude ?? createFallbackRuntimeEntry('claude'),
      loading: false,
    },
    codex: {
      runtime: providers?.codex ?? createFallbackRuntimeEntry('codex'),
      loading: false,
    },
  };
}

export function useProviderLauncher(
  dispatch: DispatchCommand,
  workspaceId: string,
  onSessionCreated: (session: Session, providerId: ProviderId) => void,
): UseProviderLauncherResult {
  const [states, setStates] = useState<Record<ProviderId, ProviderCardState>>(buildStateMap());
  const pollingTimers = useRef<Partial<Record<ProviderId, number>>>({});

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      const result = await dispatch<ProviderRuntimeStatusResponse>('provider.runtimeStatus', {});
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

      setStates((prev) => ({
        claude: {
          ...prev.claude,
          ...buildStateMap(result.data.providers).claude,
        },
        codex: {
          ...prev.codex,
          ...buildStateMap(result.data.providers).codex,
        },
      }));
    };

    void loadStatus();

    return () => {
      cancelled = true;
      for (const timer of Object.values(pollingTimers.current)) {
        if (typeof timer === 'number') {
          window.clearTimeout(timer);
        }
      }
    };
  }, [dispatch]);

  const refreshStatus = async (): Promise<void> => {
    const result = await dispatch<ProviderRuntimeStatusResponse>('provider.runtimeStatus', {});
    if (!result.ok || !result.data) {
      return;
    }

    setStates((prev) => ({
      claude: {
        ...prev.claude,
        runtime: result.data.providers.claude,
        loading: false,
      },
      codex: {
        ...prev.codex,
        runtime: result.data.providers.codex,
        loading: false,
      },
    }));
  };

  const updateFailureState = (
    providerId: ProviderId,
    failure: ProviderInstallFailure | undefined,
    inlineError?: string,
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
      const createResult = await dispatch<Session>('session.create', {
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

      if (createResult.error?.code === 'provider_cli_missing') {
        await refreshStatus();
      }

      setStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          loading: false,
          inlineError: createResult.error?.message,
        },
      }));
      return;
    }

    if (!runtime.autoInstallSupported) {
      setStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          loading: false,
          inlineError: 'manual',
        },
      }));
      return;
    }

    const startResult = await dispatch<ProviderInstallJobSnapshot>('provider.install.start', {
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

    if (startResult.data.status === 'failed') {
      updateFailureState(providerId, startResult.data.failure, startResult.data.failure?.message);
      return;
    }

    if (startResult.data.status === 'succeeded') {
      await refreshStatus();
      const createResult = await dispatch<Session>('session.create', {
        workspaceId,
        providerId,
      });

      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
      }
      return;
    }

    const poll = async () => {
      const jobResult = await dispatch<ProviderInstallJobSnapshot>('provider.install.get', {
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

      if (jobResult.data.status === 'queued' || jobResult.data.status === 'running') {
        pollingTimers.current[providerId] = window.setTimeout(poll, 1500);
        return;
      }

      if (jobResult.data.status === 'failed') {
        updateFailureState(providerId, jobResult.data.failure, jobResult.data.failure?.message);
        return;
      }

      await refreshStatus();
      const createResult = await dispatch<Session>('session.create', {
        workspaceId,
        providerId,
      });

      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
        return;
      }

      setStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          inlineError: createResult.error?.message,
          loading: false,
        },
      }));
    };

    pollingTimers.current[providerId] = window.setTimeout(poll, 1500);
  };

  return { states, launch };
}
