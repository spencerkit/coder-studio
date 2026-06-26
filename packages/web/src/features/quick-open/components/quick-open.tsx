import type { FileNode } from "@coder-studio/core";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { quickOpenOpenAtom } from "../../../atoms/app-ui";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";
import { EmptyState, ThemedIcon, WorkbenchLayer } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { useOpenWorkspaceFile } from "../../workspace/actions/use-open-workspace-file";

interface SearchFilesResult {
  files: FileNode[];
}

export function QuickOpen() {
  const t = useTranslation();
  const [open, setOpen] = useAtom(quickOpenOpenAtom);
  const workspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId ?? "__workspace_placeholder__");
  const inputRef = useRef<HTMLInputElement>(null);
  const dispatchRef = useRef(dispatch);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failedLabel = t("quick_open.failed");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }

    inputRef.current?.focus();
    setQuery("");
    setSelectedIndex(0);
    setResults([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    if (!open || !workspaceId) {
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const timeout = window.setTimeout(() => {
      void dispatchRef
        .current<SearchFilesResult>("file.search", {
          workspaceId,
          query: trimmed,
          limit: 25,
        })
        .then((result) => {
          if (cancelled) {
            return;
          }

          if (!result.ok || !result.data) {
            setResults([]);
            setError(failedLabel);
            return;
          }

          setResults(result.data.files);
          setSelectedIndex(0);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setError(failedLabel);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [failedLabel, open, query, workspaceId]);

  if (!open) {
    return null;
  }

  const activeResult = results[selectedIndex] ?? null;

  return (
    <WorkbenchLayer
      ariaLabel={t("quick_open.title")}
      initialFocus={() => inputRef.current}
      onOpenChange={setOpen}
      open
    >
      <div
        className="quick-open"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }

          if (event.key === "Enter" && activeResult && workspaceId) {
            event.preventDefault();
            void openWorkspaceFile(
              {
                workspaceId,
                path: activeResult.path,
                source: "manual",
              },
              { openTarget: "navigate" }
            );
            setOpen(false);
          }
        }}
      >
        <div className="quick-open__search">
          <ThemedIcon className="quick-open__icon" semantic="nav.search" size={16} />
          <input
            ref={inputRef}
            type="text"
            className="quick-open__input"
            aria-label={t("quick_open.title")}
            placeholder={t("quick_open.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="quick-open__list">
          {!workspaceId ? (
            <EmptyState
              className="quick-open__empty"
              title={<p>{t("workspace.no_workspace")}</p>}
            />
          ) : error ? (
            <p className="quick-open__state">{error}</p>
          ) : !query.trim() ? (
            <p className="quick-open__state">{t("quick_open.empty")}</p>
          ) : loading ? (
            <p className="quick-open__state">{t("common.loading")}</p>
          ) : results.length === 0 ? (
            <p className="quick-open__state">{t("quick_open.no_results")}</p>
          ) : (
            <div role="listbox" aria-label={t("quick_open.title")}>
              {results.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`quick-open__item${
                    index === selectedIndex ? " quick-open__item--active" : ""
                  }`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    if (!workspaceId) {
                      return;
                    }

                    void openWorkspaceFile(
                      {
                        workspaceId,
                        path: file.path,
                        source: "manual",
                      },
                      { openTarget: "navigate" }
                    );
                    setOpen(false);
                  }}
                >
                  <span className="quick-open__primary">{file.name}</span>
                  <span className="quick-open__secondary">{file.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </WorkbenchLayer>
  );
}
