import type { SearchContentMatch, SearchContentResult } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import type { FC, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { Button } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import { PanelHeader } from "../../../shared/components/panel-header";

interface SearchPanelProps {
  workspaceId: string;
}

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

export const SearchPanel: FC<SearchPanelProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const { openLocation } = useOpenLocation(workspaceId);
  const inputRef = useRef<HTMLInputElement>(null);
  const dispatchRef = useRef(dispatch);
  const [query, setQuery] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [results, setResults] = useState<SearchContentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

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
            setResults(null);
            setError(true);
            return;
          }

          setResults(result.data);
        })
        .catch(() => {
          if (!cancelled) {
            setResults(null);
            setError(true);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, retryNonce, workspaceId]);

  return (
    <div className="workspace-sidebar-view workspace-search-panel">
      <PanelHeader title={t("workspace.sidebar.search")} />

      <div className="workspace-search-panel__controls">
        <input
          ref={inputRef}
          type="search"
          aria-label={t("workspace.sidebar.search")}
          className="workspace-search-panel__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
              : t("workspace.search.empty")}
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
              onClick={() => setRetryNonce((value) => value + 1)}
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
          results.files.map((file) => (
            <section key={file.path} className="workspace-search-panel__group">
              <div className="workspace-search-panel__group-header">
                <strong>{file.name}</strong>
                <span>{file.path}</span>
                <span>
                  {t("workspace.search.file_match_count", {
                    count: file.matchCount,
                    suffix: file.hasMoreMatches ? "+" : "",
                  })}
                </span>
              </div>

              {file.matches.map((match) => (
                <button
                  key={`${file.path}:${match.line}:${match.column}`}
                  type="button"
                  className="workspace-search-panel__match"
                  onClick={() =>
                    void openLocation({
                      workspaceId,
                      path: file.path,
                      line: match.line,
                      column: match.column,
                      endColumn: match.endColumn,
                      source: "search",
                    })
                  }
                >
                  <span className="workspace-search-panel__line">{match.line}</span>
                  <span className="workspace-search-panel__preview">{renderPreview(match)}</span>
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
};
