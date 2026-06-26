import type { TerminalProfile, TerminalProfilesListResult } from "@coder-studio/core";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { type CommandResult, dispatchCommandAtom } from "../../../atoms/connection";

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

const terminalProfilesStateAtom = atom<TerminalProfilesState>(EMPTY_STATE);
export const resetTerminalProfilesAtom = atom(null, (_get, set) => {
  set(terminalProfilesStateAtom, EMPTY_STATE);
});
const inflightByStore = new WeakMap<object, Promise<TerminalProfilesState>>();

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
  const state = useAtomValue(terminalProfilesStateAtom);
  const setState = useSetAtom(terminalProfilesStateAtom);

  const loadProfiles = useCallback(async () => {
    const existingRequest = inflightByStore.get(store);
    if (existingRequest) {
      return existingRequest;
    }

    setState((current) =>
      current.loading
        ? current
        : {
            ...current,
            loading: true,
          }
    );

    const request = dispatch<TerminalProfilesListResult>("terminal.profiles.list", {})
      .then((result) => {
        const nextState = normalizeProfilesResult(result);
        store.set(terminalProfilesStateAtom, nextState);
        return nextState;
      })
      .catch(() => {
        const nextState = {
          ...EMPTY_STATE,
          loaded: true,
        };
        store.set(terminalProfilesStateAtom, nextState);
        return nextState;
      })
      .finally(() => {
        inflightByStore.delete(store);
      });

    inflightByStore.set(store, request);
    return request;
  }, [dispatch, setState, store]);

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
