import type { KeyboardEventHandler, ReactNode, RefObject } from "react";
import type { Locale, Translator } from "../../i18n";
import type { TreeNode } from "../../state/workbench";
import type { GitChangeAction, GitChangeEntry } from "../../types/app";
import {
  WorkspaceEditorPanel,
  WorkspaceFileSearchDropdown,
  WorkspaceSidebar,
} from "../../components/workspace";
import type { FileSearchDropdownStyle } from "../workspace";

type ChangeGroup = {
  key: string;
  label: string;
  items: GitChangeEntry[];
};

type FileSearchViewModel = {
  results: Array<{
    absolutePath: string;
    name: string;
    path: string;
  }>;
  query: string;
  activeIndex: number;
  showDropdown: boolean;
  dropdownStyle: FileSearchDropdownStyle | null;
  searchShellRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onFocus: (currentValue: string) => void;
  onBlur: () => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onHover: (index: number) => void;
  onSelect: (node: { absolutePath: string; name: string; path: string }) => void;
};

type SidebarViewModel = {
  view: "files" | "git";
  fileTree: TreeNode[];
  rootPath?: string;
  selectedPath?: string;
  repoCollapsedPaths: Set<string>;
  gitChangeGroups: ChangeGroup[];
  activeGitChangeKey: string;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onFileSelect: (node: TreeNode) => void;
  onToggleRepoCollapse: (path: string) => void;
  onRefresh: () => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void;
  onCommit: () => void;
  onGitChangeSelect: (change: GitChangeEntry) => void;
  onGitChangeAction: (change: GitChangeEntry, action: GitChangeAction) => void;
};

type WorkspaceCodeFeatureProps = {
  container: HTMLElement | null;
  locale: Locale;
  isExpanded: boolean;
  width: number;
  codeSidebarView: "files" | "git";
  previewPathLabel: string;
  previewFileName: string;
  editorContent: ReactNode;
  fileParentLabel: (path?: string) => string;
  sidebar: SidebarViewModel;
  fileSearch: FileSearchViewModel;
  onSetSidebarView: (view: "files" | "git") => void;
  onToggleExpanded: () => void;
  t: Translator;
};

export const WorkspaceCodeFeature = ({
  container,
  locale,
  isExpanded,
  width,
  codeSidebarView,
  previewPathLabel,
  previewFileName,
  editorContent,
  fileParentLabel,
  sidebar,
  fileSearch,
  onSetSidebarView,
  onToggleExpanded,
  t,
}: WorkspaceCodeFeatureProps) => {
  const sidebarContent = (
    <WorkspaceSidebar
      locale={locale}
      view={sidebar.view}
      fileTree={sidebar.fileTree}
      rootPath={sidebar.rootPath}
      selectedPath={sidebar.selectedPath}
      repoCollapsedPaths={sidebar.repoCollapsedPaths}
      gitChangeGroups={sidebar.gitChangeGroups}
      activeGitChangeKey={sidebar.activeGitChangeKey}
      commitMessage={sidebar.commitMessage}
      onCommitMessageChange={sidebar.onCommitMessageChange}
      onFileSelect={sidebar.onFileSelect}
      onToggleRepoCollapse={sidebar.onToggleRepoCollapse}
      onRefresh={sidebar.onRefresh}
      onStageAll={sidebar.onStageAll}
      onUnstageAll={sidebar.onUnstageAll}
      onDiscardAll={sidebar.onDiscardAll}
      onCommit={sidebar.onCommit}
      onGitChangeSelect={sidebar.onGitChangeSelect}
      onGitChangeAction={sidebar.onGitChangeAction}
      t={t}
    />
  );

  return (
    <>
      <WorkspaceEditorPanel
        locale={locale}
        isExpanded={isExpanded}
        width={width}
        codeSidebarView={codeSidebarView}
        previewPathLabel={previewPathLabel}
        previewFileName={previewFileName}
        fileSearchQuery={fileSearch.query}
        fileSearchActiveIndex={fileSearch.activeIndex}
        showFileSearchDropdown={fileSearch.showDropdown}
        searchShellRef={fileSearch.searchShellRef}
        fileSearchInputRef={fileSearch.inputRef}
        editorContent={editorContent}
        sidebarContent={sidebarContent}
        onSetSidebarView={onSetSidebarView}
        onFileSearchChange={fileSearch.onChange}
        onFileSearchFocus={fileSearch.onFocus}
        onFileSearchBlur={fileSearch.onBlur}
        onFileSearchKeyDown={fileSearch.onKeyDown}
        onToggleExpanded={onToggleExpanded}
        t={t}
      />

      {fileSearch.showDropdown && fileSearch.dropdownStyle && container && (
        <WorkspaceFileSearchDropdown
          container={container}
          locale={locale}
          dropdownStyle={fileSearch.dropdownStyle}
          results={fileSearch.results}
          activeIndex={fileSearch.activeIndex}
          onHover={fileSearch.onHover}
          onSelect={fileSearch.onSelect}
          fileParentLabel={fileParentLabel}
        />
      )}
    </>
  );
};
