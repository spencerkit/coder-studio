// COMPAT: removed in phase-3 cleanup
export {
  authenticatedAtom,
  commandPaletteOpenAtom,
  localeAtom,
  pendingFocusSessionAtom,
  themeAtom,
} from './app-ui';
export { activeWorkspaceIdAtom } from './workspaces';
export {
  bottomPanelHeightAtom,
  focusModeAtom,
  leftPanelWidthAtom,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
} from '../features/workspace/atoms/layout';
export {
  branchQuickPickAtom,
  type BranchQuickPickState,
  type GitBranchList,
  type GitDiffPreview,
} from '../features/workspace/atoms/git';
export {
  notificationPreferencesAtom,
  type NotificationPreferences,
} from '../features/notifications/atoms';
export {
  paneLayoutAtomFamily,
  type PaneNode,
} from '../features/agent-panes/atoms/pane-layout';
