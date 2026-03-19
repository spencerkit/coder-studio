import type { TreeNode } from "../../state/workbench";
import { fuzzyFileScore } from "../../shared/utils/editor";
import { resolvePath } from "../../shared/utils/path";
import { flattenTree } from "../../shared/utils/tree";

export type FileSearchDropdownStyle = {
  left: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
  top?: number;
  bottom?: number;
};

export type FileSearchNode = TreeNode & { absolutePath: string };
export type FileSearchResult = {
  node: FileSearchNode;
  score: number;
};

export type WorkspaceFileSearchState = {
  query: string;
  open: boolean;
  activeIndex: number;
  dropdownStyle: FileSearchDropdownStyle | null;
};

export const createInitialWorkspaceFileSearchState = (): WorkspaceFileSearchState => ({
  query: "",
  open: false,
  activeIndex: 0,
  dropdownStyle: null,
});

export const normalizeWorkspaceFileSearchQuery = (value: string) => value.trim().toLowerCase();

export const buildWorkspaceFileSearchResults = (
  fileTree: TreeNode[],
  projectPath: string | undefined,
  query: string
): FileSearchResult[] => {
  const normalizedQuery = normalizeWorkspaceFileSearchQuery(query);
  if (!normalizedQuery) return [];

  return flattenTree(fileTree)
    .filter((node) => node.kind === "file")
    .map((node) => ({
      node: {
        ...node,
        absolutePath: resolvePath(projectPath, node.path)
      },
      score: fuzzyFileScore(normalizedQuery, `${node.name} ${node.path}`)
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.node.path.localeCompare(right.node.path))
    .slice(0, 24);
};

export const shouldShowWorkspaceFileSearchDropdown = (state: WorkspaceFileSearchState) => (
  state.open && normalizeWorkspaceFileSearchQuery(state.query).length > 0
);

export const syncWorkspaceFileSearchState = (
  state: WorkspaceFileSearchState,
  resultsLength: number
): WorkspaceFileSearchState => {
  const normalizedQuery = normalizeWorkspaceFileSearchQuery(state.query);
  if (!normalizedQuery) {
    if (!state.open && state.activeIndex === 0 && state.dropdownStyle === null) return state;
    return { ...state, open: false, activeIndex: 0, dropdownStyle: null };
  }

  const nextIndex = Math.min(state.activeIndex, Math.max(resultsLength - 1, 0));
  if (nextIndex === state.activeIndex) return state;
  return { ...state, activeIndex: nextIndex };
};

export const updateWorkspaceFileSearchQuery = (
  state: WorkspaceFileSearchState,
  query: string
): WorkspaceFileSearchState => ({
  ...state,
  query,
  open: Boolean(normalizeWorkspaceFileSearchQuery(query)),
  activeIndex: 0,
});

export const openWorkspaceFileSearch = (state: WorkspaceFileSearchState, currentValue = state.query): WorkspaceFileSearchState => ({
  ...state,
  open: Boolean(normalizeWorkspaceFileSearchQuery(currentValue)),
});

export const closeWorkspaceFileSearch = (state: WorkspaceFileSearchState): WorkspaceFileSearchState => {
  if (!state.open) return state;
  return { ...state, open: false };
};

export const resetWorkspaceFileSearch = (state: WorkspaceFileSearchState): WorkspaceFileSearchState => {
  if (!state.query && !state.open && state.activeIndex === 0) return state;
  return {
    ...state,
    query: "",
    open: false,
    activeIndex: 0,
  };
};

export const moveWorkspaceFileSearchIndex = (
  state: WorkspaceFileSearchState,
  direction: 1 | -1,
  resultsLength: number
): WorkspaceFileSearchState => ({
  ...state,
  open: true,
  activeIndex: resultsLength === 0
    ? 0
    : direction > 0
      ? Math.min(state.activeIndex + 1, resultsLength - 1)
      : Math.max(state.activeIndex - 1, 0),
});

export const setWorkspaceFileSearchActiveIndex = (
  state: WorkspaceFileSearchState,
  activeIndex: number
): WorkspaceFileSearchState => {
  if (state.activeIndex === activeIndex) return state;
  return { ...state, activeIndex };
};

const dropdownStyleEquals = (
  left: FileSearchDropdownStyle | null,
  right: FileSearchDropdownStyle | null
) => JSON.stringify(left) === JSON.stringify(right);

export const withWorkspaceFileSearchDropdownStyle = (
  state: WorkspaceFileSearchState,
  dropdownStyle: FileSearchDropdownStyle | null
): WorkspaceFileSearchState => {
  if (dropdownStyleEquals(state.dropdownStyle, dropdownStyle)) return state;
  return {
    ...state,
    dropdownStyle,
  };
};

export const resolveWorkspaceFileSearchDropdownStyle = (
  anchor: DOMRect,
  viewportWidth: number,
  viewportHeight: number
): FileSearchDropdownStyle => {
  const width = Math.min(Math.max(anchor.width, 320), Math.max(320, viewportWidth - 24));
  const left = Math.min(Math.max(12, anchor.left), Math.max(12, viewportWidth - width - 12));
  const belowSpace = Math.max(0, viewportHeight - anchor.bottom - 12);
  const aboveSpace = Math.max(0, anchor.top - 12);
  const preferredHeight = 180;
  const placeAbove = belowSpace < preferredHeight && aboveSpace > belowSpace + 40;
  const placement = placeAbove ? "above" : "below";
  const maxHeight = Math.max(120, Math.min(420, placeAbove ? aboveSpace : belowSpace));

  return {
    left,
    width,
    maxHeight,
    placement,
    top: placeAbove ? undefined : anchor.bottom + 8,
    bottom: placeAbove ? Math.max(12, viewportHeight - anchor.top + 8) : undefined
  };
};
