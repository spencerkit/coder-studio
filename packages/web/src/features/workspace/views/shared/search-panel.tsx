import type { SearchSessionMatchPreview } from "@coder-studio/core";
import { ChevronDown, ChevronRight, ChevronUp, Regex, Replace, WholeWord } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef } from "react";
import { Button, IconButton, Switch } from "../../../../components/ui";
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

function SearchToggleButton({
  active,
  ariaLabel,
  icon,
  onClick,
  text,
}: {
  active: boolean;
  ariaLabel: string;
  icon?: ReactNode;
  onClick: () => void;
  text: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`workspace-search-panel__filter${active ? " workspace-search-panel__filter--active" : ""}`}
      onClick={onClick}
    >
      {icon ? <span className="workspace-search-panel__filter-icon">{icon}</span> : null}
      <span>{text}</span>
    </button>
  );
}

function SearchDetailSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="workspace-search-panel__detail-switch">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} size="sm" />
    </label>
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
            <input
              ref={inputRef}
              type="search"
              aria-label={t("workspace.sidebar.search")}
              className="workspace-search-panel__input workspace-sidebar-control"
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

            <div className="workspace-search-panel__icon-actions">
              <SearchToggleButton
                active={state.matchCase}
                ariaLabel={t("workspace.search.match_case")}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    matchCase: !current.matchCase,
                  }))
                }
                text={t("workspace.search.match_case")}
              />
              <SearchToggleButton
                active={state.wholeWord}
                ariaLabel={t("workspace.search.whole_word")}
                icon={<WholeWord size={12} />}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    wholeWord: !current.wholeWord,
                  }))
                }
                text={t("workspace.search.whole_word")}
              />
              <SearchToggleButton
                active={state.isRegex}
                ariaLabel={t("workspace.search.regex")}
                icon={<Regex size={12} />}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    isRegex: !current.isRegex,
                  }))
                }
                text={t("workspace.search.regex")}
              />
              <IconButton
                aria-label={t("workspace.search.toggle_replace")}
                className={`workspace-search-panel__toolbar-button${
                  state.replaceExpanded ? " workspace-search-panel__toolbar-button--active" : ""
                }`}
                icon={state.replaceExpanded ? <ChevronUp size={14} /> : <Replace size={14} />}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    replaceExpanded: !current.replaceExpanded,
                  }))
                }
                size="sm"
              />
              <IconButton
                aria-label={t("workspace.search.toggle_details")}
                className={`workspace-search-panel__toolbar-button${
                  state.detailsExpanded ? " workspace-search-panel__toolbar-button--active" : ""
                }`}
                icon={state.detailsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    detailsExpanded: !current.detailsExpanded,
                  }))
                }
                size="sm"
              />
            </div>
          </div>

          {state.replaceExpanded ? (
            <div className="workspace-search-panel__replace-row">
              <input
                type="text"
                aria-label={t("workspace.search.replace")}
                className="workspace-search-panel__input workspace-sidebar-control"
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
              <SearchToggleButton
                active={state.preserveCase}
                ariaLabel={t("workspace.search.preserve_case")}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    preserveCase: !current.preserveCase,
                  }))
                }
                text={t("workspace.search.preserve_case")}
              />
            </div>
          ) : null}

          {state.detailsExpanded ? (
            <div className="workspace-search-panel__details">
              <label className="workspace-search-panel__detail-field">
                <span>{t("workspace.search.files_to_include")}</span>
                <input
                  type="text"
                  aria-label={t("workspace.search.files_to_include")}
                  className="workspace-search-panel__input workspace-sidebar-control"
                  value={state.includeText}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      includeText: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="workspace-search-panel__detail-field">
                <span>{t("workspace.search.files_to_exclude")}</span>
                <input
                  type="text"
                  aria-label={t("workspace.search.files_to_exclude")}
                  className="workspace-search-panel__input workspace-sidebar-control"
                  value={state.excludeText}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      excludeText: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="workspace-search-panel__detail-switches">
                <SearchDetailSwitch
                  checked={state.onlyOpenEditors}
                  label={t("workspace.search.only_open_editors")}
                  onCheckedChange={(checked) =>
                    update((current) => ({
                      ...current,
                      onlyOpenEditors: checked,
                    }))
                  }
                />
                <SearchDetailSwitch
                  checked={state.useIgnoreFiles}
                  label={t("workspace.search.use_exclude_settings_and_ignore_files")}
                  onCheckedChange={(checked) =>
                    update((current) => ({
                      ...current,
                      useIgnoreFiles: checked,
                      useExcludeSettings: checked,
                    }))
                  }
                />
              </div>
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
            {hasReplace && hasQuery ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={!state.activeSessionId || state.applying}
                onClick={() => void applyReplace({ kind: "all" })}
              >
                {t("workspace.search.replace_all")}
              </Button>
            ) : null}
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
                        <strong className="workspace-search-panel__group-name">{file.name}</strong>
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
