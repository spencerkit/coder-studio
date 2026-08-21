import type {
  FileNode,
  GitCommitSummary,
  GitStatus,
  Workspace,
  WorktreeInfo,
} from "@coder-studio/core";
import { lazy, Suspense } from "react";
import { TerminalPanel } from "../../features/terminal-panel";
import { TopBar } from "../../features/topbar";
import { FileTreePanel } from "../../features/workspace/views/shared/file-tree-panel";
import { GitDiffViewer } from "../../features/workspace/views/shared/git-diff-viewer";
import { GitPanel } from "../../features/workspace/views/shared/git-panel";
import { WorkspaceLaunchModal } from "../../features/workspace/views/shared/workspace-launch-modal";
import { WorkspaceStatusBar } from "../../features/workspace/views/shared/workspace-status-bar";
import { WorktreeManagerSurface } from "../../features/workspace/views/shared/worktree-manager-surface";
import type { UiPreviewSceneDefinition } from "../catalog";
import { getUiPreviewSceneMetadata } from "../scene-metadata";

const DeferredCommandPalette = lazy(async () => {
  const module = await import("../../features/command-palette");
  return { default: module.CommandPalette };
});

const DeferredMoreFeaturesPage = lazy(async () => {
  const module = await import("../../features/more");
  return { default: module.MoreFeaturesPage };
});

const workspace: Workspace = {
  id: "ws-review",
  name: "coder-studio",
  path: "/home/spencer/workspace/coder-studio",
  targetRuntime: "native",
  openedAt: 1,
  lastActiveAt: 1,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 220,
    focusMode: false,
    activeSessionId: undefined,
    paneLayout: { id: "root", type: "leaf" },
  },
};

const gitStatus: GitStatus = {
  branch: "main",
  ahead: 1,
  behind: 0,
  staged: [{ path: "packages/web/src/styles/tokens.css", status: "modified" }],
  modified: [
    { path: "packages/web/src/styles/components.css", status: "modified" },
    { path: "packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx", status: "modified" },
  ],
  untracked: [
    { path: "e2e-ui/output/screenshots/page/workspace-topbar-review.png", status: "untracked" },
  ],
  deleted: [],
};

const gitHistory: GitCommitSummary[] = [
  {
    sha: "8f5f7d54d9f8b7f08f483699f2f16c3c442f0a11",
    shortSha: "8f5f7d5",
    subject: "style: tighten workspace desktop chrome",
    authorName: "Spencer",
    authoredAt: 1715731200000,
  },
  {
    sha: "f1c44d42d2b8ef3c83bb8aeeb0898422bf94b31c",
    shortSha: "f1c44d4",
    subject: "test: add ui preview desktop review scenes",
    authorName: "Spencer",
    authoredAt: 1715644800000,
  },
];

const worktrees: WorktreeInfo[] = [
  {
    name: "main",
    path: "/home/spencer/workspace/coder-studio",
    branch: "main",
    commit: "8f5f7d5",
    status: "clean",
  },
  {
    name: "feat-pc-style-polish",
    path: "/home/spencer/workspace/coder-studio/.worktrees/feat-pc-style-polish",
    branch: "feat/pc-style-polish",
    commit: "f1c44d4",
    status: "dirty",
  },
];

const worktreeStatusByPath: Record<string, GitStatus> = {
  [worktrees[1].path]: gitStatus,
};

const worktreeTreeByPath: Record<string, FileNode[]> = {
  [worktrees[1].path]: [
    { name: "packages", path: "packages", kind: "dir" },
    { name: "docs", path: "docs", kind: "dir" },
    { name: "README.md", path: "README.md", kind: "file" },
  ],
};

const rootTree: FileNode[] = [
  { name: "packages", path: "packages", kind: "dir" },
  { name: "docs", path: "docs", kind: "dir" },
  { name: "README.md", path: "README.md", kind: "file" },
];

const packagesTree: FileNode[] = [
  { name: "web", path: "packages/web", kind: "dir" },
  { name: "core", path: "packages/core", kind: "dir" },
];

const webTree: FileNode[] = [
  { name: "src", path: "packages/web/src", kind: "dir" },
  { name: "package.json", path: "packages/web/package.json", kind: "file" },
];

const srcTree: FileNode[] = [
  { name: "styles", path: "packages/web/src/styles", kind: "dir" },
  { name: "ui-preview", path: "packages/web/src/ui-preview", kind: "dir" },
  { name: "app.tsx", path: "packages/web/src/app.tsx", kind: "file" },
];

const searchResults: FileNode[] = [
  { name: "components.css", path: "packages/web/src/styles/components.css", kind: "file" },
  { name: "tokens.css", path: "packages/web/src/styles/tokens.css", kind: "file" },
];

const editorReviewLines = [
  "const headerTitle = isMobile",
  '  ? t(shouldShowMobileRoot ? "settings.title" : activeSectionMeta.labelKey)',
  '  : t("settings.title");',
  "",
  "return (",
  '  <div className={`settings-page ${isMobile ? "settings-page--mobile" : ""}`}>',
  '    <header className="settings-header">',
  "      <PageHeader",
  "        ...",
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

function buildWorkspaceSeed(context: {
  theme: string;
  locale: "zh" | "en";
  device: "desktop" | "mobile";
}) {
  return {
    ...context,
    workspaces: [
      workspace,
      {
        ...workspace,
        id: "ws-review-2",
        name: "playground",
        path: "/home/spencer/workspace/playground",
      },
    ],
    activeWorkspaceId: workspace.id,
    fileTreeByWorkspaceId: {
      [workspace.id]: new Map<string, FileNode[]>([
        [".", rootTree],
        ["packages", packagesTree],
        ["packages/web", webTree],
        ["packages/web/src", srcTree],
      ]),
    },
    gitStateByWorkspaceId: {
      [workspace.id]: gitStatus,
    },
    gitBranchListByWorkspaceId: {
      [workspace.id]: {
        current: "main",
        branches: [
          { name: "main", isCurrent: true, isRemote: false },
          { name: "feat/pc-style-polish", isCurrent: false, isRemote: false },
          { name: "origin/main", isCurrent: false, isRemote: true },
        ],
      },
    },
    worktreeListByWorkspaceId: {
      [workspace.id]: worktrees,
    },
    commands: {
      workspaceList: [workspace],
      fileTreeByWorkspaceId: {
        [workspace.id]: {
          ".": rootTree,
          packages: packagesTree,
          "packages/web": webTree,
          "packages/web/src": srcTree,
        },
      },
      fileSearchByWorkspaceId: {
        [workspace.id]: searchResults,
      },
      gitStatusByWorkspaceId: {
        [workspace.id]: gitStatus,
      },
      gitBranchesByWorkspaceId: {
        [workspace.id]: {
          current: "main",
          branches: [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "feat/pc-style-polish", isCurrent: false, isRemote: false },
            { name: "origin/main", isCurrent: false, isRemote: true },
          ],
        },
      },
      gitLogByWorkspaceId: {
        [workspace.id]: { entries: gitHistory },
      },
      gitDiffByWorkspaceId: {
        [workspace.id]: {
          diff: "@@ preview diff\n- background: #11181f;\n+ background: var(--bg-elevated);",
          renderAs: "text",
          status: "modified",
        },
      },
      gitCommitDetailByWorkspaceId: {
        [workspace.id]: {
          commit: {
            ...gitHistory[0],
            parentSha: gitHistory[1]?.sha,
          },
          files: [
            {
              path: "packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx",
              status: "modified",
              renderAs: "text",
            },
          ],
        },
      },
      worktreeListByWorkspaceId: {
        [workspace.id]: worktrees,
      },
      worktreeStatusByPath,
      worktreeDiffByPath: {
        [worktrees[1].path]: "@@ worktree diff\n+ packages/web/src/styles/components.css",
      },
      worktreeTreeByPath,
      terminalListByWorkspaceId: {
        [workspace.id]: [],
      },
    },
  };
}

function DesktopReviewShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `desktop-review-shell ${className}` : "desktop-review-shell"}>
      {children}
    </div>
  );
}

function DesktopEditorReviewSurface() {
  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        <div className="code-editor-header">
          <span className="code-file-path">
            packages/web/src/features/settings/components/settings-page.tsx
            <span className="dirty-indicator">*</span>
          </span>
          <div className="code-mode-toggle">
            <button type="button" className="code-mode-btn" aria-label="Save file" disabled>
              Save
            </button>
            <button
              type="button"
              className="code-mode-btn active"
              aria-label="Preview desktop header"
            >
              Preview
            </button>
          </div>
        </div>
        <div className="code-editor-body">
          <div className="code-lines">
            {editorReviewLines.map((line, index) => (
              <div key={`${index}:${line}`} className="code-line">
                <span className="code-line-num">{index + 1}</span>
                <span className="git-diff-line-text">{line || " "}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function createDesktopReviewScenes(): UiPreviewSceneDefinition[] {
  return [
    scene("workspace-topbar-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--topbar">
            <TopBar />
          </div>
        </DesktopReviewShell>
      ),
    }),
    scene("workspace-sidebar-files-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--sidebar">
            <FileTreePanel workspaceId={workspace.id} variant="desktop" />
          </div>
        </DesktopReviewShell>
      ),
    }),
    scene("workspace-sidebar-git-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--sidebar">
            <GitPanel workspaceId={workspace.id} variant="desktop" />
          </div>
        </DesktopReviewShell>
      ),
    }),
    scene("workspace-editor-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--editor">
            <DesktopEditorReviewSurface />
          </div>
        </DesktopReviewShell>
      ),
    }),
    scene("workspace-diff-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...buildWorkspaceSeed(context),
        gitDiffPreviewByWorkspaceId: {
          [workspace.id]: {
            kind: "worktree-file-diff",
            path: "packages/web/src/styles/components.css",
            diff: [
              "@@ workspace shell",
              "-  background: var(--bg-surface);",
              "+  background: var(--bg-elevated);",
              "+  border-radius: var(--radius-xl);",
            ].join("\n"),
            renderAs: "text",
            status: "modified",
          },
        },
      }),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--diff">
            <GitDiffViewer workspaceId={workspace.id} showCloseButton={false} />
          </div>
        </DesktopReviewShell>
      ),
    }),
    scene("workspace-terminal-empty-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--terminal">
            <TerminalPanel />
          </div>
        </DesktopReviewShell>
      ),
    }),
    scene("settings-density-review", {
      router: () => ({
        initialEntries: ["/more/settings/general"],
        path: "/more/settings/general",
      }),
      seed: (context) => ({
        ...buildWorkspaceSeed(context),
        commands: {
          ...buildWorkspaceSeed(context).commands,
          settingsGet: {
            "notifications.enabled": true,
            "notifications.soundEnabled": true,
            "supervisor.evaluationTimeoutSec": 600,
            "appearance.locale": context.locale,
            "appearance.themeId": context.theme,
            "appearance.terminalRenderer": "standard",
            "providers.claude.additionalArgs": ["--verbose"],
            "providers.codex.additionalArgs": ["--sandbox", "workspace-write"],
          },
          settingsUpdate: {},
          settingsPreviewCommandByProviderId: {
            claude: "claude --verbose",
            codex: "codex --sandbox workspace-write",
          },
        },
      }),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("settings-light-theme-review", {
      router: () => ({
        initialEntries: ["/more/settings/appearance"],
        path: "/more/settings/appearance",
      }),
      seed: (context) => ({
        ...buildWorkspaceSeed(context),
        commands: {
          ...buildWorkspaceSeed(context).commands,
          settingsGet: {
            "notifications.enabled": true,
            "notifications.soundEnabled": true,
            "supervisor.evaluationTimeoutSec": 600,
            "appearance.locale": context.locale,
            "appearance.themeId": context.theme,
            "appearance.terminalRenderer": "standard",
            "providers.claude.additionalArgs": ["--verbose"],
            "providers.codex.additionalArgs": ["--sandbox", "workspace-write"],
          },
          settingsUpdate: {},
          settingsPreviewCommandByProviderId: {
            claude: "claude --verbose",
            codex: "codex --sandbox workspace-write",
          },
        },
      }),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("desktop-overlay-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...buildWorkspaceSeed(context),
        commandPaletteOpen: true,
        commands: {
          ...buildWorkspaceSeed(context).commands,
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
      render: () => (
        <div className="desktop-review-grid">
          <div className="desktop-review-card">
            <Suspense fallback={null}>
              <DeferredCommandPalette />
            </Suspense>
          </div>
          <div className="desktop-review-card">
            <WorkspaceLaunchModal onClose={() => {}} />
          </div>
          <div className="desktop-review-card desktop-review-card--worktree">
            {/* Review-only inline preview: this remains a non-portaled inspection surface, not a product overlay. */}
            <div className="desktop-review-embedded-worktree">
              <WorktreeManagerSurface
                desktopPreviewInline
                workspaceId={workspace.id}
                openView="list"
                onClose={() => {}}
              />
            </div>
          </div>
        </div>
      ),
    }),
    scene("desktop-statusbar-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <DesktopReviewShell>
          <div className="desktop-review-card desktop-review-card--statusbar">
            <WorkspaceStatusBar align="start" gitState={gitStatus} workspaceId={workspace.id} />
          </div>
        </DesktopReviewShell>
      ),
    }),
  ];
}
