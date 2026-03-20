import type { KeyboardEventHandler, ReactNode, RefObject } from "react";
import type { Locale, Translator } from "../../i18n";
import { MaximizeIcon, MinimizeIcon, SearchIcon, WorkspaceChangesIcon, WorkspaceFolderIcon } from "../icons";

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
  onSetSidebarView: (view: "files" | "git") => void;
  onFileSearchChange: (value: string) => void;
  onFileSearchFocus: (currentValue: string) => void;
  onFileSearchBlur: () => void;
  onFileSearchKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onToggleExpanded: () => void;
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
  onSetSidebarView,
  onFileSearchChange,
  onFileSearchFocus,
  onFileSearchBlur,
  onFileSearchKeyDown,
  onToggleExpanded,
  t
}: WorkspaceEditorPanelProps) => (
  <section
    className="panel workspace-code-shell"
    style={isExpanded ? { flex: "1 1 100%" } : { flex: `0 0 ${width}px` }}
  >
    <div className="panel-inner workspace-code-panel">
      <div className="workspace-code-header">
        <div className="workspace-code-modes">
          {isExpanded ? (
            <>
              <button
                type="button"
                className={`workspace-panel-toggle ${codeSidebarView === "files" ? "active" : ""}`}
                onClick={() => onSetSidebarView("files")}
              >
                <WorkspaceFolderIcon />
                <span>{t("files")}</span>
              </button>
              <button
                type="button"
                className={`workspace-panel-toggle ${codeSidebarView === "git" ? "active" : ""}`}
                onClick={() => onSetSidebarView("git")}
              >
                <WorkspaceChangesIcon />
                <span>Git Diff</span>
              </button>
              {previewPathLabel && (
                <span className="workspace-code-current-path" title={previewPathLabel}>
                  {previewPathLabel}
                </span>
              )}
            </>
          ) : (
            <div className="workspace-code-title-block">
              <span className="section-kicker">{t("codePanel")}</span>
              <strong>{previewFileName || t("selectFileFromNavigator")}</strong>
            </div>
          )}
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
          <button
            type="button"
            className="workspace-icon-button"
            onClick={onToggleExpanded}
            aria-label={isExpanded ? (locale === "zh" ? "退出展开" : "Exit expand") : (locale === "zh" ? "展开代码区" : "Expand code area")}
            title={isExpanded ? (locale === "zh" ? "退出展开" : "Exit expand") : (locale === "zh" ? "展开代码区" : "Expand code area")}
          >
            {isExpanded ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
        </div>
      </div>

      <div className={`workspace-code-body ${isExpanded ? "expanded" : "collapsed"}`}>
        <div className="workspace-code-editor">{editorContent}</div>
        {isExpanded && <aside className="workspace-code-sidebar">{sidebarContent}</aside>}
      </div>
    </div>
  </section>
);

export default WorkspaceEditorPanel;
