import type { KeyboardEventHandler, ReactNode, RefObject } from "react";
import type { Locale, Translator } from "../../i18n";
import { SearchIcon } from "../icons";

type WorkspaceEditorPanelProps = {
  locale: Locale;
  isExpanded: boolean;
  width: number;
  codeSidebarView: "files" | "git";
  previewPathLabel: string;
  previewFileName: string;
  fileSearchQuery: string;
  fileSearchActiveIndex: number;
  showFileSearchDropdown: boolean;
  searchShellRef: RefObject<HTMLDivElement | null>;
  fileSearchInputRef: RefObject<HTMLInputElement | null>;
  editorContent: ReactNode;
  sidebarContent: ReactNode;
  onFileSearchChange: (value: string) => void;
  onFileSearchFocus: (currentValue: string) => void;
  onFileSearchBlur: () => void;
  onFileSearchKeyDown: KeyboardEventHandler<HTMLInputElement>;
  t: Translator;
};

export const WorkspaceEditorPanel = ({
  locale,
  isExpanded,
  width,
  codeSidebarView,
  previewPathLabel,
  previewFileName,
  fileSearchQuery,
  fileSearchActiveIndex,
  showFileSearchDropdown,
  searchShellRef,
  fileSearchInputRef,
  editorContent,
  sidebarContent,
  onFileSearchChange,
  onFileSearchFocus,
  onFileSearchBlur,
  onFileSearchKeyDown,
  t
}: WorkspaceEditorPanelProps) => (
  <section
    className="panel workspace-code-shell workspace-code-panel"
    style={isExpanded ? { flex: "1 1 100%" } : { flex: `0 0 ${width}px` }}
  >
    <div className="workspace-code-header">
      <div className="workspace-panel-title-block workspace-code-title-block">
        <span className="section-kicker">{t("codePanel")}</span>
        <strong>{previewFileName || t("selectFileFromNavigator")}</strong>
        {isExpanded && previewPathLabel ? (
          <span className="workspace-code-current-path" title={previewPathLabel}>
            {previewPathLabel}
          </span>
        ) : null}
      </div>
      <div className="workspace-code-actions">
        <div className="workspace-search-shell" ref={searchShellRef}>
          <div className="workspace-search-field">
            <SearchIcon />
            <input
              ref={fileSearchInputRef}
              value={fileSearchQuery}
              onChange={(event) => onFileSearchChange(event.target.value)}
              onFocus={(event) => onFileSearchFocus(event.currentTarget.value)}
              onBlur={onFileSearchBlur}
              onKeyDown={onFileSearchKeyDown}
              placeholder={locale === "zh" ? "搜索文件并跳转…" : "Search files and jump..."}
              autoComplete="off"
              spellCheck={false}
              aria-expanded={showFileSearchDropdown}
              aria-controls="workspace-file-search-results"
              aria-activedescendant={showFileSearchDropdown ? `workspace-file-search-option-${fileSearchActiveIndex}` : undefined}
            />
          </div>
        </div>
      </div>
    </div>

    <div className={`workspace-code-body ${isExpanded ? "expanded" : "collapsed"}`}>
      <div className="workspace-code-editor">{editorContent}</div>
      {isExpanded && (
        <aside
          className="workspace-code-sidebar workspace-review-dock"
          data-testid="workspace-review-dock"
          data-view={codeSidebarView}
        >
          {sidebarContent}
        </aside>
      )}
    </div>
  </section>
);

export default WorkspaceEditorPanel;
