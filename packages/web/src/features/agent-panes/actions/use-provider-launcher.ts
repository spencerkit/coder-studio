import type {
  ProviderInstallFailure,
  ProviderInstallJobSnapshot,
  ProviderListItem,
  ProviderRuntimeStatusEntry,
  ProviderRuntimeStatusResponse,
  Session,
} from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DispatchCommand } from "../../../atoms/connection";
import { providerListAtom, providerRuntimeStatusAtom } from "../../../atoms/providers";
import { useTerminalThemeBackground } from "../../../theme";

export type ProviderId = string;

export interface ProviderCardState {
  runtime?: ProviderRuntimeStatusEntry;
  installJob?: ProviderInstallJobSnapshot;
  loading: boolean;
  inlineError?: string;
}

interface UseProviderLauncherResult {
  providers: ProviderListItem[];
  states: Record<ProviderId, ProviderCardState>;
  launch: (providerId: ProviderId) => Promise<void>;
}

function canAutoInstall(runtime: ProviderRuntimeStatusEntry): boolean {
  return runtime.autoInstallSupported && runtime.installReadiness === "ready";
}

function createFallbackProvider(providerId: string): ProviderListItem {
  const title = providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

  return {
    id: providerId,
    displayName: title,
    badge: title,
    kind: "built_in",
    capability: "unsupported",
    capabilities: [],
    requiredCommands: [],
  };
}

function createFallbackRuntimeEntry(provider: ProviderListItem): ProviderRuntimeStatusEntry {
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    badge: provider.badge,
    kind: provider.kind,
    stability: provider.stability,
    supportsAgentInstructions: provider.supportsAgentInstructions,
    supportsAgentInstructionsGeneration: provider.supportsAgentInstructionsGeneration,
    supportsSkillsMount: provider.supportsSkillsMount,
    capability: provider.capability,
    capabilities: provider.capabilities.map((capability) => ({ ...capability })),
    requiredCommands: [...provider.requiredCommands],
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

function normalizeProviders(
  providers?: ProviderListItem[],
  providerRuntimeStatus?: ProviderRuntimeStatusResponse["providers"]
): ProviderListItem[] {
  const orderedProviders = Array.isArray(providers) ? [...providers] : [];
  const providerIds = new Set(orderedProviders.map((provider) => provider.id));

  for (const providerId of Object.keys(providerRuntimeStatus ?? {})) {
    if (!providerIds.has(providerId)) {
      orderedProviders.push(createFallbackProvider(providerId));
    }
  }

  return orderedProviders;
}

function buildStateMap(
  providerList: ProviderListItem[],
  providers?: ProviderRuntimeStatusResponse["providers"]
): Record<ProviderId, ProviderCardState> {
  return Object.fromEntries(
    providerList.map((provider) => [
      provider.id,
      {
        runtime: providers?.[provider.id] ?? createFallbackRuntimeEntry(provider),
        loading: false,
      },
    ])
  );
}

export function useProviderLauncher(
  dispatch: DispatchCommand,
  workspaceId: string,
  onSessionCreated: (session: Session, providerId: ProviderId) => void,
  _continuation?: { paneId?: string; launchMode?: "assign" | "replace" }
): UseProviderLauncherResult {
  const cachedProviders = useAtomValue(providerListAtom);
  const providerRuntimeStatus = useAtomValue(providerRuntimeStatusAtom);
  const setProviderRuntimeStatus = useSetAtom(providerRuntimeStatusAtom);
  const [states, setStates] = useState<Record<ProviderId, ProviderCardState>>(() =>
    buildStateMap(cachedProviders)
  );
  const providers = useMemo(
    () => normalizeProviders(cachedProviders, providerRuntimeStatus),
    [cachedProviders, providerRuntimeStatus]
  );
  const cachedProvidersRef = useRef<ProviderListItem[]>(cachedProviders);
  const providersRef = useRef<ProviderListItem[]>(providers);
  const pollingTimers = useRef<Partial<Record<ProviderId, number>>>({});
  const themeBackground = useTerminalThemeBackground();

  useEffect(() => {
    cachedProvidersRef.current = cachedProviders;
    providersRef.current = providers;
    setStates((prev) =>
      Object.fromEntries(
        providers.map((provider) => [
          provider.id,
          {
            runtime:
              providerRuntimeStatus?.[provider.id] ??
              prev[provider.id]?.runtime ??
              createFallbackRuntimeEntry(provider),
            installJob: prev[provider.id]?.installJob,
            loading: prev[provider.id]?.loading ?? false,
            inlineError: prev[provider.id]?.inlineError,
          },
        ])
      )
    );
  }, [cachedProviders, providerRuntimeStatus, providers]);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      const runtimeResult = await dispatch<ProviderRuntimeStatusResponse>(
        "provider.runtimeStatus",
        {}
      );

      if (cancelled) {
        return;
      }

      const nextProviderList = cachedProvidersRef.current;
      const nextProviderRuntimeStatus = runtimeResult.ok
        ? runtimeResult.data?.providers
        : undefined;
      const nextProviders = normalizeProviders(nextProviderList, nextProviderRuntimeStatus);
      const nextStates = buildStateMap(nextProviders, nextProviderRuntimeStatus);

      setProviderRuntimeStatus(nextProviderRuntimeStatus);
      providersRef.current = nextProviders;
      setStates((prev) =>
        Object.fromEntries(
          nextProviders.map((provider) => [
            provider.id,
            {
              ...nextStates[provider.id],
              installJob: prev[provider.id]?.installJob,
              loading: prev[provider.id]?.loading ?? false,
              inlineError: prev[provider.id]?.inlineError,
            },
          ])
        )
      );
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
  }, [dispatch, setProviderRuntimeStatus]);

  const refreshStatus = async (): Promise<void> => {
    const result = await dispatch<ProviderRuntimeStatusResponse>("provider.runtimeStatus", {});
    if (!result.ok || !result.data) {
      return;
    }

    const nextProviderList = normalizeProviders(providersRef.current, result.data.providers);
    const nextStates = buildStateMap(nextProviderList, result.data.providers);

    providersRef.current = nextProviderList;
    setProviderRuntimeStatus(result.data.providers);

    setStates((prev) =>
      Object.fromEntries(
        nextProviderList.map((provider) => {
          const nextState = nextStates[provider.id];

          return [
            provider.id,
            {
              ...prev[provider.id],
              runtime: nextState?.runtime ?? createFallbackRuntimeEntry(provider),
              loading: false,
            },
          ];
        })
      )
    );
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
        installJob: prev[providerId]?.installJob
          ? {
              ...prev[providerId].installJob,
              failure,
            }
          : prev[providerId]?.installJob,
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
    const state = states[providerId];
    const runtime = state?.runtime;
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
        themeBackground,
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
        themeBackground,
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
        themeBackground,
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

  return { providers, states, launch };
}
