import type { TerminalProfile, TerminalProfilesListResult } from "@coder-studio/core";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { type CommandResult, dispatchCommandAtom } from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";

interface TerminalProfilesState {
  profiles: TerminalProfile[];
  configuredDefaultProfileId?: string;
  resolvedDefaultProfileId: string | null;
  loading: boolean;
  loaded: boolean;
}

const EMPTY_STATE: TerminalProfilesState = {
  profiles: [],
  configuredDefaultProfileId: undefined,
  resolvedDefaultProfileId: null,
  loading: false,
  loaded: false,
};

const terminalProfilesStateAtom = atom<Record<string, TerminalProfilesState>>({});
export const resetTerminalProfilesAtom = atom(null, (_get, set) => {
  set(terminalProfilesStateAtom, {});
});
const inflightByStore = new WeakMap<object, Map<string, Promise<TerminalProfilesState>>>();

const GLOBAL_WORKSPACE_KEY = "__global__";

function normalizeProfilesResult(
  result: CommandResult<TerminalProfilesListResult>
): TerminalProfilesState {
  if (!result.ok || !result.data) {
    return {
      ...EMPTY_STATE,
      loaded: true,
    };
  }

  const profiles = Array.isArray(result.data.profiles) ? result.data.profiles : [];
  const configuredDefaultProfileId =
    typeof result.data.configuredDefaultProfileId === "string"
      ? result.data.configuredDefaultProfileId
      : undefined;
  const resolvedDefaultProfileId =
    typeof result.data.resolvedDefaultProfileId === "string"
      ? result.data.resolvedDefaultProfileId
      : null;

  return {
    profiles,
    configuredDefaultProfileId,
    resolvedDefaultProfileId,
    loading: false,
    loaded: true,
  };
}

export function useTerminalProfiles() {
  const store = useStore();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const workspaceKey = activeWorkspaceId ?? GLOBAL_WORKSPACE_KEY;
  const stateByWorkspace = useAtomValue(terminalProfilesStateAtom);
  const state = stateByWorkspace[workspaceKey] ?? EMPTY_STATE;
  const setState = useSetAtom(terminalProfilesStateAtom);

  const loadProfiles = useCallback(async () => {
    const inflightByWorkspace = inflightByStore.get(store);
    const existingRequest = inflightByWorkspace?.get(workspaceKey);
    if (existingRequest) {
      return existingRequest;
    }

    setState((current) =>
      (current[workspaceKey] ?? EMPTY_STATE).loading
        ? current
        : {
            ...current,
            [workspaceKey]: {
              ...(current[workspaceKey] ?? EMPTY_STATE),
              loading: true,
            },
          }
    );

    const request = dispatch<TerminalProfilesListResult>("terminal.profiles.list", {
      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
    })
      .then((result) => {
        const nextState = normalizeProfilesResult(result);
        store.set(terminalProfilesStateAtom, (current) => ({
          ...current,
          [workspaceKey]: nextState,
        }));
        return nextState;
      })
      .catch(() => {
        const nextState = {
          ...EMPTY_STATE,
          loaded: true,
        };
        store.set(terminalProfilesStateAtom, (current) => ({
          ...current,
          [workspaceKey]: nextState,
        }));
        return nextState;
      })
      .finally(() => {
        const current = inflightByStore.get(store);
        current?.delete(workspaceKey);
        if (current && current.size === 0) {
          inflightByStore.delete(store);
        }
      });

    const nextInflightByWorkspace =
      inflightByWorkspace ?? new Map<string, Promise<TerminalProfilesState>>();
    nextInflightByWorkspace.set(workspaceKey, request);
    inflightByStore.set(store, nextInflightByWorkspace);
    return request;
  }, [activeWorkspaceId, dispatch, setState, store, workspaceKey]);

  useEffect(() => {
    if (state.loaded || state.loading) {
      return;
    }

    void loadProfiles();
  }, [loadProfiles, state.loaded, state.loading]);

  const defaultProfile = useMemo(() => {
    if (!state.profiles.length) {
      return null;
    }

    return (
      state.profiles.find((profile) => profile.id === state.resolvedDefaultProfileId) ??
      state.profiles[0] ??
      null
    );
  }, [state.profiles, state.resolvedDefaultProfileId]);

  return {
    profiles: state.profiles,
    configuredDefaultProfileId: state.configuredDefaultProfileId,
    resolvedDefaultProfileId: state.resolvedDefaultProfileId,
    defaultProfile,
    loading: state.loading,
    async ensureProfilesLoaded() {
      if (state.loaded) {
        return state;
      }

      return loadProfiles();
    },
  };
}
