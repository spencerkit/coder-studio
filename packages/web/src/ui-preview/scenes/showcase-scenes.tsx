import type { FileNode, GitStatus, Supervisor, Workspace, WorktreeInfo } from "@coder-studio/core";
import {
  CircleAlert,
  CircleCheckBig,
  CircleDot,
  File,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  Image as ImageIcon,
} from "lucide-react";
import { ConfirmDialog, EmptyState, Notice, Sheet } from "../../components/ui";
import { CommandPalette } from "../../features/command-palette";
import { ToastContainer } from "../../features/notifications";
import { MobileSupervisorBadge } from "../../features/supervisor/views/mobile/mobile-supervisor-badge";
import { MobileSupervisorSheet } from "../../features/supervisor/views/mobile/mobile-supervisor-sheet";
import { ObjectiveDialog } from "../../features/supervisor/views/shared/objective-dialog";
import { XtermPlaceholder } from "../../features/terminal-panel/views/shared/xterm-placeholder";
import { MobileDock } from "../../features/workspace/views/mobile/mobile-dock";
import { MobileWorkspaceDrawer } from "../../features/workspace/views/mobile/mobile-workspace-drawer";
import { BranchQuickPick } from "../../features/workspace/views/shared/branch-quick-pick";
import { WorkspaceLaunchModal } from "../../features/workspace/views/shared/workspace-launch-modal";
import { WorktreeManagerSurface } from "../../features/workspace/views/shared/worktree-manager-surface";
import type { UiPreviewSceneContext, UiPreviewSceneDefinition } from "../catalog";
import { getUiPreviewSceneMetadata } from "../scene-metadata";

const workspace: Workspace = {
  id: "ws-preview",
  name: "coder-studio",
  path: "/home/spencer/workspace/coder-studio",
  targetRuntime: "native",
  openedAt: 1,
  lastActiveAt: 1,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 220,
    focusMode: false,
    activeSessionId: "session-preview-1",
    paneLayout: { id: "root", type: "leaf" },
  },
};

const supervisor: Supervisor = {
  id: "sup-preview-1",
  sessionId: "session-preview-1",
  workspaceId: "ws-preview",
  state: "idle",
  objective: "Review UI regressions before shipping",
  evaluatorProviderId: "claude",
  maxSupervisionCount: 0,
  completedSupervisionCount: 0,
  cycles: [],
  createdAt: 1,
  updatedAt: 1,
};

const worktrees: WorktreeInfo[] = [
  {
    name: "feature/e2e-ui",
    path: "/home/spencer/workspace/coder-studio-feature-e2e-ui",
    branch: "feature/e2e-ui",
    commit: "abc1234",
    status: "dirty",
  },
];

const worktreeStatus: GitStatus = {
  branch: "feature/e2e-ui",
  ahead: 1,
  behind: 0,
  staged: [],
  modified: [{ path: "packages/web/src/ui-preview/app.tsx", status: "modified" }],
  untracked: [],
  deleted: [],
};

const worktreeTree: FileNode[] = [
  { name: "packages", path: "packages", kind: "dir" },
  { name: "e2e-ui", path: "e2e-ui", kind: "dir" },
];

function scene(
  id: string,
  config: Pick<UiPreviewSceneDefinition, "router" | "seed" | "render">
): UiPreviewSceneDefinition {
  const metadata = getUiPreviewSceneMetadata(id);
  if (!metadata) {
    throw new Error(`Missing UI preview metadata for ${id}`);
  }

  return {
    ...metadata,
    ...config,
  };
}

export function createShowcaseScenes(): UiPreviewSceneDefinition[] {
  return [
    scene("workspace-launch-modal", {
      router: () => ({ initialEntries: ["/"], path: "/" }),
      seed: (context) => ({
        ...context,
        commands: {
          workspaceBrowse: {
            currentPath: "/home/spencer/workspace",
            parentPath: "/home/spencer",
            directories: [
              { name: "coder-studio", path: "/home/spencer/workspace/coder-studio", itemCount: 24 },
              { name: "playground", path: "/home/spencer/workspace/playground", itemCount: 6 },
            ],
          },
          workspaceOpen: workspace,
        },
      }),
      render: () => <WorkspaceLaunchModal onClose={() => {}} />,
    }),
    scene("command-palette", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        commandPaletteOpen: true,
      }),
      render: () => <CommandPalette />,
    }),
    scene("branch-quick-pick", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        branchQuickPick: {
          visible: true,
          workspaceId: workspace.id,
          inputValue: "",
        },
        commands: {
          gitBranchesByWorkspaceId: {
            [workspace.id]: {
              current: "main",
              branches: [
                { name: "main", isCurrent: true, isRemote: false },
                { name: "feature/e2e-ui", isCurrent: false, isRemote: false },
                { name: "origin/main", isCurrent: false, isRemote: true },
              ],
            },
          },
          gitStatusByWorkspaceId: {
            [workspace.id]: worktreeStatus,
          },
        },
      }),
      render: () => <BranchQuickPick />,
    }),
    scene("toast-stack", {
      router: () => ({ initialEntries: ["/"], path: "/" }),
      seed: (context) => ({
        ...context,
        toasts: [
          {
            id: "toast-success-preview",
            kind: "success",
            title: "Workspace opened",
            body: "coder-studio is ready.",
            createdAt: 1,
            duration: 0,
          },
          {
            id: "toast-error-preview",
            kind: "error",
            title: "Failed to refresh provider config",
            body: "Retry after checking the provider settings.",
            createdAt: 2,
            duration: 0,
          },
        ],
      }),
      render: () => <ToastContainer />,
    }),
    scene("workspace-icon-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        supervisorBySessionId: {
          "session-preview-1": supervisor,
        },
      }),
      render: (context) =>
        context.device === "mobile" ? (
          <div className="workspace-icon-review">
            <div className="mobile-shell__stage">
              <div className="flex items-center justify-between gap-3 p-3">
                <MobileSupervisorBadge sessionId="session-preview-1" onOpen={() => {}} />
              </div>
              <div className="file-tree-shell file-tree-shell--mobile">
                <div className="tree-item">
                  <span className="tree-icon folder" aria-hidden="true">
                    <Folder size={14} />
                  </span>
                  <span>packages</span>
                </div>
                <div className="tree-item">
                  <span className="tree-icon code" aria-hidden="true">
                    <FileCode2 size={14} />
                  </span>
                  <span>app.tsx</span>
                </div>
                <div className="tree-item">
                  <span className="tree-icon data" aria-hidden="true">
                    <FileJson2 size={14} />
                  </span>
                  <span>theme.json</span>
                </div>
                <div className="tree-item">
                  <span className="tree-icon doc" aria-hidden="true">
                    <FileText size={14} />
                  </span>
                  <span>README.md</span>
                </div>
              </div>
              <MobileDock activeItem="files" onSelectItem={() => {}} />
            </div>
          </div>
        ) : (
          <div className="workspace-icon-review">
            <div className="file-tree-shell">
              <div className="tree-item">
                <span className="tree-icon folder" aria-hidden="true">
                  <Folder size={14} />
                </span>
                <span>packages</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon code" aria-hidden="true">
                  <FileCode2 size={14} />
                </span>
                <span>app.tsx</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon data" aria-hidden="true">
                  <FileJson2 size={14} />
                </span>
                <span>theme.json</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon doc" aria-hidden="true">
                  <FileText size={14} />
                </span>
                <span>README.md</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon media" aria-hidden="true">
                  <ImageIcon size={14} />
                </span>
                <span>logo.png</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon file" aria-hidden="true">
                  <File size={14} />
                </span>
                <span>LICENSE</span>
              </div>
            </div>
            <div className="git-panel">
              <div className="git-row">
                <span className="git-row-icon git-row-icon-staged" aria-hidden="true">
                  <CircleCheckBig size={12} />
                </span>
                <span>staged.ts</span>
              </div>
              <div className="git-row">
                <span className="git-row-icon git-row-icon-modified" aria-hidden="true">
                  <CircleAlert size={12} />
                </span>
                <span>modified.ts</span>
              </div>
              <div className="git-row">
                <span className="git-row-icon git-row-icon-deleted" aria-hidden="true">
                  <CircleAlert size={12} />
                </span>
                <span>deleted.ts</span>
              </div>
              <div className="git-row">
                <span className="git-row-icon git-row-icon-untracked" aria-hidden="true">
                  <CircleDot size={12} />
                </span>
                <span>untracked.ts</span>
              </div>
            </div>
          </div>
        ),
    }),
    scene("toast-icon-review", {
      router: () => ({ initialEntries: ["/"], path: "/" }),
      seed: (context) => ({
        ...context,
        toasts: [
          {
            id: "toast-success",
            kind: "success",
            title: "Workspace opened",
            body: "coder-studio is ready.",
            createdAt: 1,
            duration: 0,
          },
          {
            id: "toast-warning",
            kind: "warning",
            title: "Unsaved config",
            body: "Review pending changes before continuing.",
            createdAt: 2,
            duration: 0,
          },
          {
            id: "toast-error",
            kind: "error",
            title: "Failed to refresh provider config",
            body: "Retry after checking the provider settings.",
            createdAt: 3,
            duration: 0,
          },
          {
            id: "toast-info",
            kind: "info",
            title: "Theme preview active",
            body: "Comparing icon palettes across themes.",
            createdAt: 4,
            duration: 0,
          },
        ],
      }),
      render: () => <ToastContainer />,
    }),
    scene("supervisor-icon-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        supervisorBySessionId: {
          "session-preview-1": supervisor,
        },
        supervisorDialog: {
          open: true,
          sessionId: "session-preview-1",
          mode: "disable",
          draftObjective: supervisor.objective,
          draftEvaluatorProviderId: "claude",
          draftEvaluatorModel: "",
          draftMaxSupervisionCount: "0",
          draftScheduledAt: "",
        },
      }),
      render: (context) =>
        context.device === "mobile" ? (
          <MobileSupervisorSheet
            sessionId="session-preview-1"
            workspaceId={workspace.id}
            onClose={() => {}}
          />
        ) : (
          <ObjectiveDialog workspaceId={workspace.id} sessionId="session-preview-1" />
        ),
    }),
    scene("mobile-workspace-drawer", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [
          workspace,
          {
            ...workspace,
            id: "ws-preview-2",
            name: "playground",
            path: "/home/spencer/workspace/playground",
          },
        ],
        activeWorkspaceId: workspace.id,
      }),
      render: () => (
        <MobileWorkspaceDrawer
          activeWorkspaceId={workspace.id}
          isOpen
          workspaces={[
            workspace,
            {
              ...workspace,
              id: "ws-preview-2",
              name: "playground",
              path: "/home/spencer/workspace/playground",
            },
          ]}
          onClose={() => {}}
          onOpenWorkspaceLauncher={() => {}}
        />
      ),
    }),
    scene("mobile-files-sheet", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({ ...context }),
      render: () => (
        <Sheet
          title="Files"
          fullscreen
          bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen"
          contentClassName="mobile-sheet--files"
          onClose={() => {}}
          body={
            <div className="mobile-files-sheet">
              <div className="file-tree-shell file-tree-shell--mobile">
                <div className="file-tree">
                  <div className="file-tree-row">packages/web/src/app.tsx</div>
                  <div className="file-tree-row">packages/web/src/ui-preview/app.tsx</div>
                </div>
              </div>
            </div>
          }
        />
      ),
    }),
    scene("mobile-terminal-sheet", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({ ...context }),
      render: () => (
        <Sheet
          title="Terminal"
          fullscreen
          bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen"
          contentClassName="mobile-sheet--terminal"
          onClose={() => {}}
          body={
            <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
              <XtermPlaceholder state="granting" />
            </div>
          }
        />
      ),
    }),
    scene("mobile-supervisor-sheet", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        supervisorBySessionId: {
          "session-preview-1": supervisor,
        },
      }),
      render: () => (
        <MobileSupervisorSheet
          sessionId="session-preview-1"
          workspaceId={workspace.id}
          onClose={() => {}}
        />
      ),
    }),
    scene("supervisor-dialog", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        supervisorBySessionId: {
          "session-preview-1": supervisor,
        },
        supervisorDialog: {
          open: true,
          sessionId: "session-preview-1",
          mode: "edit",
          draftObjective: supervisor.objective,
          draftEvaluatorProviderId: "claude",
        },
      }),
      render: () => <ObjectiveDialog workspaceId={workspace.id} sessionId="session-preview-1" />,
    }),
    scene("worktree-manager", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        worktreeListByWorkspaceId: {
          [workspace.id]: worktrees,
        },
        commands: {
          worktreeListByWorkspaceId: {
            [workspace.id]: worktrees,
          },
          worktreeStatusByPath: {
            [worktrees[0].path]: worktreeStatus,
          },
          worktreeDiffByPath: {
            [worktrees[0].path]: "diff --git a/src/app.tsx b/src/app.tsx",
          },
          worktreeTreeByPath: {
            [worktrees[0].path]: worktreeTree,
          },
        },
      }),
      render: () => (
        <WorktreeManagerSurface workspaceId={workspace.id} openView="list" onClose={() => {}} />
      ),
    }),
    scene("confirm-dialog-danger", {
      router: () => ({ initialEntries: ["/"], path: "/" }),
      seed: (context) => ({ ...context }),
      render: () => (
        <ConfirmDialog
          open
          onOpenChange={() => {}}
          tone="danger"
          title="Delete worktree?"
          description="This removes the worktree directory from disk."
          cancelText="Cancel"
          confirmText="Delete"
          onConfirm={() => {}}
        />
      ),
    }),
    scene("provider-error-state", {
      router: () => ({ initialEntries: ["/settings"], path: "/settings" }),
      seed: (context) => ({ ...context }),
      render: () => (
        <div className="settings-page">
          <Notice
            tone="error"
            title="Failed to refresh provider config"
            message="Retry after checking the provider settings."
            action={<button className="settings-link">Retry</button>}
          />
        </div>
      ),
    }),
    scene("file-tree-delete-confirm", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({ ...context }),
      render: () => (
        <ConfirmDialog
          open
          onOpenChange={() => {}}
          tone="danger"
          title="Delete preview-file.ts?"
          description="This permanently removes the file from the current workspace."
          cancelText="Cancel"
          confirmText="Delete"
          onConfirm={() => {}}
        />
      ),
    }),
    scene("empty-state", {
      router: () => ({ initialEntries: ["/"], path: "/" }),
      seed: (context) => ({ ...context }),
      render: () => (
        <div className="welcome-card">
          <EmptyState title={<p>No results</p>} description={<p>Try a different filter.</p>} />
        </div>
      ),
    }),
    scene("loading-state", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [],
        activeWorkspaceId: null,
      }),
      render: () => (
        <div className="workspace-resolving-shell">
          <div className="workspace-resolving-card">
            <EmptyState title={<p>Loading workspace</p>} description={<p>Please wait...</p>} />
          </div>
        </div>
      ),
    }),
  ];
}
