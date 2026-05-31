import type { SearchSessionMatchPreview } from "@coder-studio/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef } from "react";
import { Button } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenWorkspaceFile } from "../../actions/use-open-workspace-file";
import { useSearchPreviewActions } from "../../actions/use-search-preview-actions";
import {
  buildSearchPanelMatchKey,
  renderSearchPanelSummary,
  useSearchPanelState,
} from "./search-panel-state";

interface SearchPanelProps {
  workspaceId: string;
  refreshToken?: number;
  variant?: "desktop" | "mobile";
  onSelectFile?: (path: string) => void;
}

function renderPreview(
  preview: string,
  startColumn: number,
  endColumn: number,
  className = "workspace-search-panel__preview"
): ReactNode {
  const start = Math.max(0, startColumn - 1);
  const end = Math.max(start, endColumn - 1);

  return (
    <span className={className}>
      {preview.slice(0, start)}
      <mark>{preview.slice(start, end)}</mark>
      {preview.slice(end)}
    </span>
  );
}

function ReplaceAllIcon() {
  return (
    <svg
      aria-hidden="true"
      className="workspace-search-panel__inline-icon"
      viewBox="0 0 12 12"
      fill="none"
    >
      <path d="M2 3.25h4.5" />
      <path d="M5.25 1.9l1.35 1.35-1.35 1.35" />
      <path d="M10 8.75H5.5" />
      <path d="M6.75 7.4L5.4 8.75l1.35 1.35" />
      <rect x="1.75" y="6.75" width="2.1" height="2.1" rx=".35" />
      <rect x="8.15" y="3.15" width="2.1" height="2.1" rx=".35" />
    </svg>
  );
}

function IgnoreFilesIcon() {
  return (
    <svg
      aria-hidden="true"
      className="workspace-search-panel__inline-icon"
      viewBox="0 0 12 12"
      fill="none"
    >
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <path d="M6 1.75v1" />
      <path d="M6 9.25v1" />
      <path d="M1.75 6h1" />
      <path d="M9.25 6h1" />
      <path d="M2.8 2.8l.7.7" />
      <path d="M8.5 8.5l.7.7" />
      <path d="M8.5 3.5l.7-.7" />
      <path d="M2.8 9.2l.7-.7" />
    </svg>
  );
}

function SearchDetailsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="workspace-search-panel__inline-icon"
      viewBox="0 0 12 12"
      fill="currentColor"
      stroke="none"
    >
      <circle cx="2.25" cy="6" r=".95" />
      <circle cx="6" cy="6" r=".95" />
      <circle cx="9.75" cy="6" r=".95" />
    </svg>
  );
}

function SearchToggleButton({
  active,
  ariaLabel,
  onClick,
  children,
  className,
}: {
  active: boolean;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`workspace-search-panel__filter${active ? " workspace-search-panel__filter--active" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function SearchActionButton({
  ariaLabel,
  children,
  className,
  disabled = false,
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`workspace-search-panel__filter${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export const SearchPanel: FC<SearchPanelProps> = ({
  workspaceId,
  refreshToken = 0,
  variant = "desktop",
  onSelectFile,
}) => {
  const t = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const groupIdPrefix = useId();
  const { state, update, applyReplace } = useSearchPanelState(workspaceId, refreshToken);
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);
  const { openSearchPreview } = useSearchPreviewActions(workspaceId);
  const summary = renderSearchPanelSummary(state.result);
  const hasQuery = Boolean(state.query.trim());
  const hasReplace = state.replaceExpanded && state.replaceText.length > 0;
  const hasResults = Boolean(state.result && state.result.files.length > 0);
  const resultSummaryText = hasQuery
    ? t("workspace.search.results_count", {
        count: summary.matchCount,
        files: summary.fileCount,
      })
    : "";

  useEffect(() => {
    inputRef.current?.focus();
  }, [workspaceId]);

  const openMatch = async (
    path: string,
    match: Pick<SearchSessionMatchPreview, "column" | "endColumn" | "line">
  ) => {
    await openWorkspaceFile({
      workspaceId,
      path,
      line: match.line,
      column: match.column,
      endColumn: match.endColumn,
      source: "search",
    });
    onSelectFile?.(path);
  };

  const footerMessage = useMemo(() => {
    if (!state.result) {
      return null;
    }

    const notes: string[] = [];
    if (state.result.hasMoreFiles || state.result.truncatedMatchFileCount > 0) {
      notes.push(t("workspace.search.truncated"));
    }
    if (state.result.skippedBinaryFileCount > 0 || state.result.skippedLargeFileCount > 0) {
      notes.push(
        t("workspace.search.skipped_files", {
          binary: state.result.skippedBinaryFileCount,
          large: state.result.skippedLargeFileCount,
        })
      );
    }
    return notes.join(" ");
  }, [state.result, t]);

  const renderFilePathMeta = (path: string, name: string) => {
    if (path === name) {
      return null;
    }

    return <span className="workspace-search-panel__group-path">{path}</span>;
  };

  return (
    <div
      className={`workspace-sidebar-view workspace-search-panel workspace-search-panel--${variant}`}
    >
      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
        <div className="workspace-search-panel__controls">
          <div className="workspace-search-panel__toolbar">
            <div className="workspace-search-panel__leading-actions">
              <button
                type="button"
                aria-label={t("workspace.search.toggle_replace")}
                className={`workspace-search-panel__leading-toggle${
                  state.replaceExpanded ? " workspace-search-panel__leading-toggle--active" : ""
                }`}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    replaceExpanded: !current.replaceExpanded,
                    detailsExpanded: current.replaceExpanded ? false : current.detailsExpanded,
                  }))
                }
              >
                {state.replaceExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>

            <div className="workspace-search-panel__compound-control">
              <input
                ref={inputRef}
                type="search"
                aria-label={t("workspace.sidebar.search")}
                className="workspace-search-panel__input"
                value={state.query}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    query: event.target.value,
                    applySummary: null,
                  }))
                }
                placeholder={t("workspace.search.placeholder")}
              />

              <div className="workspace-search-panel__compound-actions">
                <SearchToggleButton
                  active={state.matchCase}
                  ariaLabel={t("workspace.search.match_case")}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      matchCase: !current.matchCase,
                    }))
                  }
                >
                  Aa
                </SearchToggleButton>
                <SearchToggleButton
                  active={state.wholeWord}
                  ariaLabel={t("workspace.search.whole_word")}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      wholeWord: !current.wholeWord,
                    }))
                  }
                >
                  ab
                </SearchToggleButton>
                <SearchToggleButton
                  active={state.isRegex}
                  ariaLabel={t("workspace.search.regex")}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      isRegex: !current.isRegex,
                    }))
                  }
                >
                  .*
                </SearchToggleButton>
              </div>
            </div>
          </div>

          {state.replaceExpanded ? (
            <div className="workspace-search-panel__replace-row">
              <div className="workspace-search-panel__row-offset" aria-hidden="true" />
              <div className="workspace-search-panel__compound-control">
                <input
                  type="text"
                  aria-label={t("workspace.search.replace")}
                  className="workspace-search-panel__input"
                  value={state.replaceText}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      replaceText: event.target.value,
                      applySummary: null,
                    }))
                  }
                  placeholder={t("workspace.search.replace_placeholder")}
                />
                <div className="workspace-search-panel__compound-actions">
                  <SearchToggleButton
                    active={state.preserveCase}
                    ariaLabel={t("workspace.search.preserve_case")}
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        preserveCase: !current.preserveCase,
                      }))
                    }
                    className="workspace-search-panel__filter--compact"
                  >
                    AB
                  </SearchToggleButton>
                  <SearchActionButton
                    ariaLabel={t("workspace.search.replace_all")}
                    className="workspace-search-panel__filter--icon"
                    disabled={!hasReplace || !hasQuery || !state.activeSessionId || state.applying}
                    onClick={() => void applyReplace({ kind: "all" })}
                  >
                    <ReplaceAllIcon />
                  </SearchActionButton>
                </div>
              </div>
            </div>
          ) : null}

          {state.replaceExpanded ? (
            <div
              className={`workspace-search-panel__details${
                state.detailsExpanded ? "" : " workspace-search-panel__details--collapsed"
              }`}
            >
              {!state.detailsExpanded ? (
                <SearchToggleButton
                  active={state.detailsExpanded}
                  ariaLabel={t("workspace.search.toggle_details")}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      detailsExpanded: !current.detailsExpanded,
                    }))
                  }
                  className="workspace-search-panel__filter--icon workspace-search-panel__filter--details"
                >
                  <SearchDetailsIcon />
                </SearchToggleButton>
              ) : null}

              {state.detailsExpanded ? (
                <>
                  <label className="workspace-search-panel__detail-field">
                    <span className="workspace-search-panel__detail-heading">
                      <span className="workspace-search-panel__detail-label">
                        {t("workspace.search.files_to_include")}
                      </span>
                      <SearchToggleButton
                        active={state.detailsExpanded}
                        ariaLabel={t("workspace.search.toggle_details")}
                        onClick={() =>
                          update((current) => ({
                            ...current,
                            detailsExpanded: !current.detailsExpanded,
                          }))
                        }
                        className="workspace-search-panel__filter--icon workspace-search-panel__filter--details"
                      >
                        <SearchDetailsIcon />
                      </SearchToggleButton>
                    </span>
                    <div className="workspace-search-panel__compound-control">
                      <input
                        type="text"
                        aria-label={t("workspace.search.files_to_include")}
                        className="workspace-search-panel__input"
                        value={state.includeText}
                        onChange={(event) =>
                          update((current) => ({
                            ...current,
                            includeText: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </label>
                  <label className="workspace-search-panel__detail-field">
                    <span className="workspace-search-panel__detail-label">
                      {t("workspace.search.files_to_exclude")}
                    </span>
                    <div className="workspace-search-panel__compound-control">
                      <input
                        type="text"
                        aria-label={t("workspace.search.files_to_exclude")}
                        className="workspace-search-panel__input"
                        value={state.excludeText}
                        onChange={(event) =>
                          update((current) => ({
                            ...current,
                            excludeText: event.target.value,
                          }))
                        }
                      />
                      <SearchToggleButton
                        active={state.useIgnoreFiles}
                        ariaLabel={t("workspace.search.use_exclude_settings_and_ignore_files")}
                        onClick={() =>
                          update((current) => ({
                            ...current,
                            useIgnoreFiles: !current.useIgnoreFiles,
                            useExcludeSettings: !current.useIgnoreFiles,
                          }))
                        }
                        className="workspace-search-panel__filter--icon workspace-search-panel__filter--suffix"
                      >
                        <IgnoreFilesIcon />
                      </SearchToggleButton>
                    </div>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          {state.error ? (
            <p className="workspace-search-panel__error">
              {state.error.code === "invalid_regex"
                ? t("workspace.search.invalid_regex")
                : state.error.message || t("workspace.search.failed")}
            </p>
          ) : null}

          <div className="workspace-search-panel__summary">
            <span>{state.loading ? t("common.loading") : resultSummaryText}</span>
          </div>

          {footerMessage ? (
            <div className="workspace-search-panel__truncate-note">{footerMessage}</div>
          ) : null}
        </div>

        <div className="workspace-search-panel__results">
          {!hasQuery ? (
            <p className="workspace-search-panel__state">{t("workspace.search.empty")}</p>
          ) : state.loading && !hasResults ? (
            <p className="workspace-search-panel__state">{t("common.loading")}</p>
          ) : state.error ? null : !hasResults ? (
            <p className="workspace-search-panel__state">{t("workspace.search.no_results")}</p>
          ) : (
            state.result?.files.map((file, index) => {
              const isExpanded = state.expandedFiles[file.path] ?? true;
              const matchesId = `${groupIdPrefix}-group-${index}`;
              return (
                <section key={file.path} className="workspace-search-panel__group">
                  <div className="workspace-search-panel__group-header-row">
                    <button
                      type="button"
                      className="workspace-search-panel__group-header"
                      onClick={() =>
                        update((current) => ({
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
                        <span className="workspace-search-panel__group-name">{file.name}</span>
                        {renderFilePathMeta(file.path, file.name)}
                      </span>
                      <span className="workspace-search-panel__group-count" aria-hidden="true">
                        {file.matchCount}
                      </span>
                      <span className="workspace-search-panel__group-count-a11y">
                        {t("workspace.search.file_match_count", {
                          count: file.matchCount,
                          suffix: "",
                        })}
                      </span>
                    </button>

                    {hasReplace ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void applyReplace({ kind: "file", path: file.path })}
                      >
                        {t("workspace.search.replace_in_file")}
                      </Button>
                    ) : null}
                  </div>

                  <div
                    id={matchesId}
                    hidden={!isExpanded}
                    className="workspace-search-panel__matches"
                  >
                    {isExpanded
                      ? file.matches.map((match) => {
                          const matchKey = buildSearchPanelMatchKey(file.path, match);
                          const isSelected = state.selectedMatchKey === matchKey;
                          return (
                            <div key={matchKey} className="workspace-search-panel__match-shell">
                              <button
                                type="button"
                                className={`workspace-search-panel__match workspace-sidebar-row${
                                  isSelected
                                    ? " workspace-search-panel__match--active workspace-sidebar-row--selected"
                                    : ""
                                }`}
                                aria-current={isSelected ? "true" : undefined}
                                onClick={() => {
                                  update((current) => ({
                                    ...current,
                                    selectedMatchKey: matchKey,
                                  }));
                                  void openMatch(file.path, match);
                                }}
                              >
                                <span className="workspace-search-panel__line">{match.line}</span>
                                <span className="workspace-search-panel__match-copy">
                                  {renderPreview(
                                    match.preview,
                                    match.previewColumnStart,
                                    match.previewColumnEnd
                                  )}
                                  {hasReplace ? (
                                    <span className="workspace-search-panel__replacement">
                                      {renderPreview(
                                        match.replacementPreview,
                                        match.replacementPreviewColumnStart,
                                        match.replacementPreviewColumnEnd,
                                        "workspace-search-panel__replacement-preview"
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                              </button>

                              <div className="workspace-search-panel__match-actions">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void openSearchPreview(state.activeSessionId ?? "", file.path)
                                  }
                                >
                                  {t("workspace.search.preview")}
                                </Button>
                                {hasReplace ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      void applyReplace({
                                        kind: "match",
                                        path: file.path,
                                        matchId: match.id,
                                      })
                                    }
                                  >
                                    {t("workspace.search.replace_match")}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      : null}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
