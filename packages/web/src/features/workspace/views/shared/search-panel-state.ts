import type {
  SearchSessionApplyResult,
  SearchSessionApplyScope,
  SearchSessionStartResult,
} from "@coder-studio/core";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomFamily } from "jotai-family";
import { useCallback, useEffect, useMemo } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { openEditorPathsAtomFamily } from "../../atoms";

export const SEARCH_PANEL_DEBOUNCE_MS = 250;
export const SEARCH_PANEL_MAX_FILES = 50;
export const SEARCH_PANEL_MAX_MATCHES_PER_FILE = 20;

interface SearchPanelCommandError {
  code: string;
  message: string;
}

export interface SearchPanelState {
  query: string;
  replaceText: string;
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  preserveCase: boolean;
  includeText: string;
  excludeText: string;
  onlyOpenEditors: boolean;
  useIgnoreFiles: boolean;
  useExcludeSettings: boolean;
  replaceExpanded: boolean;
  detailsExpanded: boolean;
  refreshNonce: number;
  resolvedRequestKey: string;
  result: SearchSessionStartResult | null;
  activeSessionId: string | null;
  selectedMatchKey: string | null;
  expandedFiles: Record<string, boolean>;
  loading: boolean;
  applying: boolean;
  error: SearchPanelCommandError | null;
  applySummary: SearchSessionApplyResult | null;
}

const DEFAULT_STATE: SearchPanelState = {
  query: "",
  replaceText: "",
  matchCase: false,
  wholeWord: false,
  isRegex: false,
  preserveCase: false,
  includeText: "",
  excludeText: "",
  onlyOpenEditors: false,
  useIgnoreFiles: true,
  useExcludeSettings: true,
  replaceExpanded: false,
  detailsExpanded: false,
  refreshNonce: 0,
  resolvedRequestKey: "",
  result: null,
  activeSessionId: null,
  selectedMatchKey: null,
  expandedFiles: {},
  loading: false,
  applying: false,
  error: null,
  applySummary: null,
};

const searchPanelStateAtomFamily = atomFamily((_: string) =>
  atom<SearchPanelState>({
    ...DEFAULT_STATE,
    expandedFiles: {},
  })
);

export function splitSearchGlobInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildSearchPanelMatchKey(
  filePath: string,
  match: { id?: string; line: number; column: number; endColumn: number }
) {
  return `${filePath}:${match.id ?? `${match.line}:${match.column}:${match.endColumn}`}`;
}

export function renderSearchPanelSummary(result: SearchSessionStartResult | null) {
  if (!result) {
    return {
      matchCount: 0,
      fileCount: 0,
    };
  }

  return {
    matchCount: result.totalMatchCount,
    fileCount: result.totalFileCount,
  };
}

function getInitialExpandedFiles(result: SearchSessionStartResult): Record<string, boolean> {
  return Object.fromEntries(result.files.map((file) => [file.path, file.matches.length > 0]));
}

function getFirstSelectedMatch(result: SearchSessionStartResult): string | null {
  for (const file of result.files) {
    const match = file.matches[0];
    if (match) {
      return buildSearchPanelMatchKey(file.path, match);
    }
  }

  return null;
}

function buildSearchRequestKey(
  state: SearchPanelState,
  openEditorPaths: string[]
): { key: string; args: null | Record<string, unknown> } {
  const query = state.query.trim();
  if (!query) {
    return { key: "", args: null };
  }

  const includeGlobs = splitSearchGlobInput(state.includeText);
  const excludeGlobs = splitSearchGlobInput(state.excludeText);
  const normalizedOpenEditorPaths = [...openEditorPaths].sort();
  const args = {
    query,
    replace: state.replaceText,
    isRegex: state.isRegex,
    matchCase: state.matchCase,
    matchWholeWord: state.wholeWord,
    preserveCase: state.preserveCase,
    includeGlobs,
    excludeGlobs,
    useIgnoreFiles: state.useIgnoreFiles,
    useExcludeSettings: state.useExcludeSettings,
    onlyOpenEditors: state.onlyOpenEditors,
    openEditorPaths: normalizedOpenEditorPaths,
    maxFiles: SEARCH_PANEL_MAX_FILES,
    maxMatchesPerFile: SEARCH_PANEL_MAX_MATCHES_PER_FILE,
  };

  return {
    key: JSON.stringify({
      ...args,
      refreshNonce: state.refreshNonce,
    }),
    args,
  };
}

export function useSearchPanelState(workspaceId: string, refreshToken = 0) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const openEditorPaths = useAtomValue(openEditorPathsAtomFamily(workspaceId));
  const [state, setState] = useAtom(searchPanelStateAtomFamily(workspaceId));
  const request = useMemo(
    () =>
      buildSearchRequestKey(
        {
          ...DEFAULT_STATE,
          query: state.query,
          replaceText: state.replaceText,
          matchCase: state.matchCase,
          wholeWord: state.wholeWord,
          isRegex: state.isRegex,
          preserveCase: state.preserveCase,
          includeText: state.includeText,
          excludeText: state.excludeText,
          onlyOpenEditors: state.onlyOpenEditors,
          useIgnoreFiles: state.useIgnoreFiles,
          useExcludeSettings: state.useExcludeSettings,
          refreshNonce: state.refreshNonce,
        },
        openEditorPaths
      ),
    [
      openEditorPaths,
      state.excludeText,
      state.includeText,
      state.isRegex,
      state.matchCase,
      state.onlyOpenEditors,
      state.preserveCase,
      state.query,
      state.refreshNonce,
      state.replaceText,
      state.useExcludeSettings,
      state.useIgnoreFiles,
      state.wholeWord,
    ]
  );

  useEffect(() => {
    if (refreshToken <= 0 || !state.query.trim()) {
      return;
    }

    setState((current) => ({
      ...current,
      refreshNonce: current.refreshNonce + 1,
    }));
  }, [refreshToken, setState, state.query]);

  useEffect(() => {
    if (!request.args) {
      setState((current) => {
        if (
          !current.result &&
          !current.activeSessionId &&
          !current.selectedMatchKey &&
          Object.keys(current.expandedFiles).length === 0 &&
          !current.loading &&
          !current.error
        ) {
          return current;
        }

        return {
          ...current,
          resolvedRequestKey: "",
          result: null,
          activeSessionId: null,
          selectedMatchKey: null,
          expandedFiles: {},
          loading: false,
          error: null,
        };
      });
      return;
    }

    let cancelled = false;
    setState((current) =>
      current.loading && current.resolvedRequestKey === request.key
        ? current
        : {
            ...current,
            loading: true,
            error: null,
          }
    );

    const timeoutId = window.setTimeout(() => {
      void dispatch<SearchSessionStartResult>("file.searchSession.start", {
        workspaceId,
        ...request.args,
      })
        .then((result) => {
          if (cancelled) {
            return;
          }

          if (!result.ok || !result.data) {
            setState((current) => ({
              ...current,
              resolvedRequestKey: "",
              result: null,
              activeSessionId: null,
              selectedMatchKey: null,
              expandedFiles: {},
              error: result.error ?? {
                code: "search_failed",
                message: "Search failed",
              },
            }));
            return;
          }

          setState((current) => ({
            ...current,
            resolvedRequestKey: request.key,
            result: result.data,
            activeSessionId: result.data.sessionId,
            selectedMatchKey: getFirstSelectedMatch(result.data),
            expandedFiles: getInitialExpandedFiles(result.data),
            error: null,
          }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setState((current) => ({
            ...current,
            resolvedRequestKey: "",
            result: null,
            activeSessionId: null,
            selectedMatchKey: null,
            expandedFiles: {},
            error: {
              code: "search_failed",
              message: error instanceof Error ? error.message : "Search failed",
            },
          }));
        })
        .finally(() => {
          if (cancelled) {
            return;
          }

          setState((current) => ({
            ...current,
            loading: false,
          }));
        });
    }, SEARCH_PANEL_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [dispatch, request.args, request.key, setState, workspaceId]);

  const update = useCallback(
    (updater: (current: SearchPanelState) => SearchPanelState) => {
      setState(updater);
    },
    [setState]
  );

  const rerunSearch = useCallback(() => {
    setState((current) => ({
      ...current,
      refreshNonce: current.refreshNonce + 1,
    }));
  }, [setState]);

  const applyReplace = useCallback(
    async (scope: SearchSessionApplyScope) => {
      if (!state.activeSessionId) {
        return null;
      }

      setState((current) => ({
        ...current,
        applying: true,
      }));

      const result = await dispatch<SearchSessionApplyResult>("file.searchSession.apply", {
        workspaceId,
        sessionId: state.activeSessionId,
        scope,
      });

      setState((current) => ({
        ...current,
        applying: false,
        activeSessionId:
          result.ok && result.data?.status === "stale_session" ? null : current.activeSessionId,
        applySummary: result.ok ? (result.data ?? null) : current.applySummary,
        error:
          result.ok || !result.error
            ? current.error
            : {
                code: result.error.code,
                message: result.error.message,
              },
        refreshNonce: current.refreshNonce + 1,
      }));

      return result.ok ? (result.data ?? null) : null;
    },
    [dispatch, setState, state.activeSessionId, workspaceId]
  );

  return {
    state,
    openEditorPaths,
    update,
    rerunSearch,
    applyReplace,
    buildMatchKey: buildSearchPanelMatchKey,
  };
}
