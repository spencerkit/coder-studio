import type { SearchContentMatch, SearchContentResult } from "@coder-studio/core";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { Button } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import { PanelHeader } from "../../../shared/components/panel-header";
import { deriveEditorModeForPath, editorModeAtomFamily } from "../../atoms";

interface SearchPanelProps {
  workspaceId: string;
  variant?: "desktop" | "mobile";
  onSelectFile?: (path: string) => void;
}

interface SearchPanelState {
  query: string;
  retryNonce: number;
  resolvedQuery: string;
  resolvedRetryNonce: number;
  results: SearchContentResult | null;
  expandedFiles: Record<string, boolean>;
  loading: boolean;
  error: boolean;
}

const searchPanelStateAtomFamily = atomFamily((workspaceId: string) =>
  atom<SearchPanelState>({
    query: "",
    retryNonce: 0,
    resolvedQuery: "",
    resolvedRetryNonce: 0,
    results: null,
    expandedFiles: {},
    loading: false,
    error: false,
  })
);

function renderPreview(match: SearchContentMatch): ReactNode {
  const start = Math.max(0, match.previewColumnStart - 1);
  const end = Math.max(start, match.previewColumnEnd - 1);

  return (
    <>
      {match.preview.slice(0, start)}
      <mark>{match.preview.slice(start, end)}</mark>
      {match.preview.slice(end)}
    </>
  );
}

function buildExpandedFileMap(results: SearchContentResult): Record<string, boolean> {
  return Object.fromEntries(results.files.map((file) => [file.path, true]));
}

export const SearchPanel: FC<SearchPanelProps> = ({
  workspaceId,
  variant = "desktop",
  onSelectFile,
}) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const { openLocation } = useOpenLocation(workspaceId);
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const inputRef = useRef<HTMLInputElement>(null);
  const dispatchRef = useRef(dispatch);
  const groupIdPrefix = useId();
  const [state, setState] = useAtom(searchPanelStateAtomFamily(workspaceId));
  const {
    error,
    expandedFiles,
    loading,
    query,
    resolvedQuery,
    resolvedRetryNonce,
    results,
    retryNonce,
  } = state;

  useEffect(() => {
    inputRef.current?.focus();
  }, [workspaceId]);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setState((current) =>
        current.results !== null ||
        current.resolvedQuery ||
        Object.keys(current.expandedFiles).length > 0 ||
        current.loading ||
        current.error
          ? {
              ...current,
              resolvedQuery: "",
              resolvedRetryNonce: current.retryNonce,
              results: null,
              expandedFiles: {},
              loading: false,
              error: false,
            }
          : current
      );
      return;
    }

    if (results && !error && resolvedQuery === trimmed && resolvedRetryNonce === retryNonce) {
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      loading: true,
      error: false,
    }));

    const timeout = window.setTimeout(() => {
      void dispatchRef
        .current<SearchContentResult>("file.searchContent", {
          workspaceId,
          query: trimmed,
          maxFiles: 50,
          maxMatchesPerFile: 20,
        })
        .then((result) => {
          if (cancelled) {
            return;
          }

          if (!result.ok || !result.data) {
            setState((current) => ({
              ...current,
              results: null,
              expandedFiles: {},
              error: true,
            }));
            return;
          }

          setState((current) => ({
            ...current,
            resolvedQuery: trimmed,
            resolvedRetryNonce: retryNonce,
            results: result.data,
            expandedFiles: buildExpandedFileMap(result.data),
          }));
        })
        .catch(() => {
          if (!cancelled) {
            setState((current) => ({
              ...current,
              results: null,
              expandedFiles: {},
              error: true,
            }));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setState((current) => ({
              ...current,
              loading: false,
            }));
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, retryNonce, setState, workspaceId]);

  const openMatch = (path: string, line: number, column: number, endColumn: number) => {
    setEditorMode(deriveEditorModeForPath(path));
    void openLocation({
      workspaceId,
      path,
      line,
      column,
      endColumn,
      source: "search",
    });
    onSelectFile?.(path);
  };

  return (
    <div
      className={`workspace-sidebar-view workspace-search-panel workspace-search-panel--${variant}`}
    >
      {variant === "desktop" ? <PanelHeader title={t("workspace.sidebar.search")} /> : null}

      <div className="workspace-search-panel__controls">
        <input
          ref={inputRef}
          type="search"
          aria-label={t("workspace.sidebar.search")}
          className="workspace-search-panel__input"
          value={query}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              query: event.target.value,
            }))
          }
          placeholder={t("workspace.search.placeholder")}
        />

        <div className="workspace-search-panel__summary">
          {loading
            ? t("common.loading")
            : query.trim()
              ? t("workspace.search.results_count", {
                  count: results?.totalMatchCount ?? 0,
                  files: results?.files.length ?? 0,
                })
              : null}
        </div>

        {results && (results.hasMoreFiles || results.truncatedMatchFileCount > 0) ? (
          <div className="workspace-search-panel__truncate-note">
            {t("workspace.search.truncated")}
          </div>
        ) : null}
      </div>

      <div className="workspace-search-panel__results">
        {error ? (
          <div className="workspace-search-panel__state-block">
            <p className="workspace-search-panel__state">{t("workspace.search.failed")}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  retryNonce: current.retryNonce + 1,
                }))
              }
            >
              {t("workspace.search.retry")}
            </Button>
          </div>
        ) : !query.trim() ? (
          <p className="workspace-search-panel__state">{t("workspace.search.empty")}</p>
        ) : loading ? (
          <p className="workspace-search-panel__state">{t("common.loading")}</p>
        ) : !results || results.files.length === 0 ? (
          <p className="workspace-search-panel__state">{t("workspace.search.no_results")}</p>
        ) : (
          results.files.map((file, index) => {
            const matchesId = `${groupIdPrefix}-group-${index}`;
            const isExpanded = expandedFiles[file.path] ?? true;

            return (
              <section key={file.path} className="workspace-search-panel__group">
                <button
                  type="button"
                  className="workspace-search-panel__group-header"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      expandedFiles: {
                        ...current.expandedFiles,
                        [file.path]: !(current.expandedFiles[file.path] ?? true),
                      },
                    }))
                  }
                  aria-expanded={isExpanded}
                  aria-controls={matchesId}
                >
                  <span className="workspace-search-panel__group-chevron" aria-hidden="true">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="workspace-search-panel__group-copy">
                    <strong className="workspace-search-panel__group-name">{file.name}</strong>
                    <span className="workspace-search-panel__group-path">{file.path}</span>
                  </span>
                  <span className="workspace-search-panel__group-count">
                    {t("workspace.search.file_match_count", {
                      count: file.matchCount,
                      suffix: file.hasMoreMatches ? "+" : "",
                    })}
                  </span>
                </button>

                <div
                  id={matchesId}
                  hidden={!isExpanded}
                  className="workspace-search-panel__matches"
                >
                  {isExpanded
                    ? file.matches.map((match) => (
                        <button
                          key={`${file.path}:${match.line}:${match.column}`}
                          type="button"
                          className="workspace-search-panel__match"
                          onClick={() =>
                            openMatch(file.path, match.line, match.column, match.endColumn)
                          }
                        >
                          <span className="workspace-search-panel__line">{match.line}</span>
                          <span className="workspace-search-panel__preview">
                            {renderPreview(match)}
                          </span>
                        </button>
                      ))
                    : null}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};
