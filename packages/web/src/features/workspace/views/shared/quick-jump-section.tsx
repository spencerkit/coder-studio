import type { FileNode } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenWorkspaceFile } from "../../actions/use-open-workspace-file";

interface SearchFilesResult {
  files: FileNode[];
}

interface QuickJumpSectionProps {
  workspaceId: string;
  onSelectFile?: (path: string) => void;
}

export function QuickJumpSection({ workspaceId, onSelectFile }: QuickJumpSectionProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestIdRef = useRef(0);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const requestId = ++requestIdRef.current;

    const timeout = window.setTimeout(() => {
      void dispatch<SearchFilesResult>("file.search", {
        workspaceId,
        query: trimmed,
        limit: 10,
      })
        .then((result) => {
          if (cancelled || requestId !== requestIdRef.current) {
            return;
          }

          if (!result.ok || !result.data) {
            setResults([]);
            setFailed(true);
            return;
          }

          setResults(result.data.files);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setFailed(true);
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
  }, [dispatch, query, workspaceId]);

  return (
    <section className="workspace-sidebar-section workspace-quick-jump">
      <h2 className="workspace-sidebar-section__title">{t("workspace.quick_jump.title")}</h2>
      <label className="workspace-quick-jump__search" htmlFor={`quick-jump-${workspaceId}`}>
        <ThemedIcon semantic="nav.search" size={14} aria-hidden="true" />
        <input
          id={`quick-jump-${workspaceId}`}
          type="search"
          className="workspace-quick-jump__input"
          aria-label={t("workspace.quick_jump.title")}
          placeholder={t("workspace.quick_jump.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {hasQuery ? (
        <div className="workspace-quick-jump__results">
          {loading ? (
            <p className="workspace-quick-jump__state">{t("common.loading")}</p>
          ) : failed ? (
            <p className="workspace-quick-jump__state">{t("workspace.quick_jump.failed")}</p>
          ) : results.length === 0 ? (
            <p className="workspace-quick-jump__state">{t("workspace.quick_jump.no_results")}</p>
          ) : (
            results.map((file) => (
              <button
                key={file.path}
                type="button"
                className="workspace-quick-jump__item"
                aria-label={file.path}
                onClick={() => {
                  void openWorkspaceFile({
                    workspaceId,
                    path: file.path,
                    source: "manual",
                  });
                  onSelectFile?.(file.path);
                }}
              >
                <span className="workspace-quick-jump__primary">{file.name}</span>
                <span className="workspace-quick-jump__secondary">{file.path}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
