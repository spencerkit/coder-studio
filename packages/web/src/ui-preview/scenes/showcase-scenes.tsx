import type {
  FileNode,
  GitStatus,
  Supervisor,
  UpdateStateView,
  Workspace,
  WorktreeInfo,
} from "@coder-studio/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import { ConfirmDialog, EmptyState, Notice, Sheet, ThemedIcon } from "../../components/ui";
import { SessionCard } from "../../features/agent-panes/views/shared/session-card";
import { CommandPalette } from "../../features/command-palette";
import { ToastContainer } from "../../features/notifications";
import { MobileSupervisorBadge } from "../../features/supervisor/views/mobile/mobile-supervisor-badge";
import { MobileSupervisorSheet } from "../../features/supervisor/views/mobile/mobile-supervisor-sheet";
import { ObjectiveDialog } from "../../features/supervisor/views/shared/objective-dialog";
import { SupervisorCard } from "../../features/supervisor/views/shared/supervisor-card";
import { TerminalPanel } from "../../features/terminal-panel";
import { TopBar } from "../../features/topbar";
import { WorkspaceDesktopView } from "../../features/workspace/views/desktop/workspace-desktop-view";
import { MobileDock } from "../../features/workspace/views/mobile/mobile-dock";
import { MobileFilesSheet } from "../../features/workspace/views/mobile/mobile-files-sheet";
import { MobileTopBar } from "../../features/workspace/views/mobile/mobile-topbar";
import { MobileWorkspaceDrawer } from "../../features/workspace/views/mobile/mobile-workspace-drawer";
import { BranchQuickPick } from "../../features/workspace/views/shared/branch-quick-pick";
import { GitDiffViewer } from "../../features/workspace/views/shared/git-diff-viewer";
import { GitPanel } from "../../features/workspace/views/shared/git-panel";
import { WorkspaceLaunchModal } from "../../features/workspace/views/shared/workspace-launch-modal";
import { WorkspaceStatusBar } from "../../features/workspace/views/shared/workspace-status-bar";
import { WorktreeManagerSurface } from "../../features/workspace/views/shared/worktree-manager-surface";
import { useTranslation } from "../../lib/i18n";
import type { UiPreviewSceneDefinition } from "../catalog";
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
  targetId: "target-preview-1",
  objective: "Review UI regressions before shipping",
  evaluatorProviderId: "claude",
  maxSupervisionCount: 0,
  completedSupervisionCount: 0,
  currentTargetMemory: {
    targetId: "target-preview-1",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [
      {
        id: "stage-1",
        kind: "stage",
        title: "Audit compact strip density",
        objective: "Review density regressions in the compact strip",
        deliverable: "A verified density audit",
        acceptanceCriteria: ["Density issues are identified"],
        status: "done",
      },
      {
        id: "stage-2",
        kind: "stage",
        title: "Move memory into expandable detail",
        objective: "Expose target memory without bloating the strip",
        deliverable: "A compact card with explicit decomposition detail",
        acceptanceCriteria: ["Decomposition is visible without expanding layout noise"],
        status: "in_progress",
      },
      {
        id: "stage-3",
        kind: "stage",
        title: "Validate preview coverage across themes",
        objective: "Ensure preview coverage is representative",
        deliverable: "A validated preview pass",
        acceptanceCriteria: ["Preview coverage is confirmed"],
        status: "pending",
      },
    ],
    activeItemId: "stage-2",
    progressSummary: "Compact strip restored; preview coverage still under review.",
    stalledCount: 0,
    updatedAt: 1,
  },
  recentTargetCycles: [
    {
      cycleId: "target-cycle-preview-1",
      targetId: "target-preview-1",
      startedAt: 1,
      completedAt: 2,
      result: "continue",
      reason: "Keep the strip compact and move detailed memory into an explicit disclosure.",
    },
  ],
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

const footerUpdateRailPreviewState: UpdateStateView = {
  version: 1,
  currentVersion: "0.4.0",
  latestVersion: "0.5.0",
  availability: "update_available",
  updateStatus: "idle",
  lastCheckedAt: 1715731200000,
  targetVersion: null,
  startedAt: null,
  finishedAt: null,
  requiresManualStep: false,
  manualCommand: null,
  errorSummary: null,
  supported: true,
  installKind: "global_npm",
  unsupportedReason: null,
};

const fileTreeRoot: FileNode[] = [
  { name: "packages", path: "packages", kind: "dir" },
  { name: "README.md", path: "README.md", kind: "file" },
  { name: "pnpm-workspace.yaml", path: "pnpm-workspace.yaml", kind: "file" },
];

const fileTreePackages: FileNode[] = [
  { name: "web", path: "packages/web", kind: "dir" },
  { name: "core", path: "packages/core", kind: "dir" },
];

const readmeDesktopGitStatus: GitStatus = {
  branch: "feature/readme-refresh",
  ahead: 2,
  behind: 0,
  headSha: "97cc218f926d61bbeca0d6a8bd4b62582cbf93ea",
  headShortSha: "97cc218",
  headSubject: "feat: stage readme screenshot refresh scenes",
  staged: [{ path: "README.md", status: "modified" }],
  modified: [
    { path: "packages/web/src/features/topbar/index.tsx", status: "modified" },
    { path: "docs/help/assets/screenshot-desktop-workspace-full.png", status: "modified" },
  ],
  untracked: [{ path: "docs/help/assets/screenshot-mobile-progress.png", status: "untracked" }],
  deleted: [],
};

const readmeDesktopHistory = [
  {
    sha: "97cc218f926d61bbeca0d6a8bd4b62582cbf93ea",
    shortSha: "97cc218",
    subject: "feat: stage readme screenshot refresh scenes",
    authorName: "Spencer",
    authoredAt: 1_715_731_200_000,
  },
  {
    sha: "4d6fd0bbce5100f39277c9c9c92677b87de17b73",
    shortSha: "4d6fd0b",
    subject: "style: tighten header action hierarchy",
    authorName: "Spencer",
    authoredAt: 1_715_644_800_000,
  },
] as const;

const readmeDesktopSessions = [
  {
    id: "session-readme-hero",
    workspaceId: workspace.id,
    terminalId: "term-agent-readme-hero",
    providerId: "codex",
    state: "running" as const,
    capability: "full" as const,
    startedAt: 1,
    lastActiveAt: 3,
    title: "Ship the header polish and verify README visuals",
  },
];

const readmeMobileSessions = [
  {
    id: "session-readme-mobile",
    workspaceId: workspace.id,
    terminalId: "term-agent-readme-mobile",
    providerId: "claude",
    state: "idle" as const,
    capability: "full" as const,
    startedAt: 1,
    lastActiveAt: 4,
    title: "Resume mobile progress review",
  },
];

const readmeSupervisor: Supervisor = {
  id: "sup-readme-hero",
  sessionId: "session-readme-hero",
  workspaceId: workspace.id,
  state: "evaluating",
  targetId: "target-readme-refresh",
  objective: "Refresh README screenshots to highlight active cross-device coding flows",
  evaluatorProviderId: "claude",
  maxSupervisionCount: 0,
  completedSupervisionCount: 3,
  currentTargetMemory: {
    targetId: "target-readme-refresh",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [
      {
        id: "stage-1",
        kind: "stage",
        title: "Capture a desktop hero with active session context",
        objective: "Show an active desktop coding flow",
        deliverable: "A readable hero screenshot",
        acceptanceCriteria: ["Hero capture is readable"],
        status: "done",
      },
      {
        id: "stage-2",
        kind: "stage",
        title: "Capture a focused git review scene for README",
        objective: "Highlight review context clearly",
        deliverable: "A focused review screenshot",
        acceptanceCriteria: ["Diff emphasis is readable"],
        status: "in_progress",
      },
      {
        id: "stage-3",
        kind: "stage",
        title: "Capture a mobile progress check with supervisor status",
        objective: "Show mobile progress visibility",
        deliverable: "A mobile supervisor progress screenshot",
        acceptanceCriteria: ["Mobile supervisor state is legible"],
        status: "pending",
      },
    ],
    activeItemId: "stage-2",
    progressSummary: "Hero scene locked. Review capture is being polished for README readability.",
    stalledCount: 0,
    updatedAt: 4,
  },
  recentTargetCycles: [
    {
      cycleId: "target-cycle-readme-1",
      targetId: "target-readme-refresh",
      startedAt: 2,
      completedAt: 3,
      result: "continue",
      reason: "Hero screenshot is readable. Review scene still needs clearer diff emphasis.",
    },
  ],
  createdAt: 1,
  updatedAt: 4,
};

const readmeMobileSupervisor: Supervisor = {
  ...readmeSupervisor,
  id: "sup-readme-mobile",
  sessionId: "session-readme-mobile",
  state: "idle",
  currentTargetMemory: {
    targetId: "target-readme-refresh",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [
      {
        id: "stage-1",
        kind: "stage",
        title: "Capture a desktop hero with active session context",
        objective: "Show an active desktop coding flow",
        deliverable: "A readable hero screenshot",
        acceptanceCriteria: ["Hero capture is readable"],
        status: "done",
      },
      {
        id: "stage-2",
        kind: "stage",
        title: "Capture a focused git review scene for README",
        objective: "Highlight review context clearly",
        deliverable: "A focused review screenshot",
        acceptanceCriteria: ["Diff emphasis is readable"],
        status: "done",
      },
      {
        id: "stage-3",
        kind: "stage",
        title: "Capture a mobile progress check with supervisor status",
        objective: "Show mobile progress visibility",
        deliverable: "A mobile supervisor progress screenshot",
        acceptanceCriteria: ["Mobile supervisor state is legible"],
        status: "in_progress",
      },
    ],
    activeItemId: "stage-3",
    progressSummary:
      "Desktop captures are ready. Mobile continuity shot is the last remaining asset.",
    stalledCount: 0,
    updatedAt: 5,
  },
  recentTargetCycles: [
    {
      cycleId: "target-cycle-readme-mobile-1",
      targetId: "target-readme-refresh",
      startedAt: 4,
      completedAt: 5,
      result: "continue",
      reason:
        "Desktop assets are approved. Capture a mobile status-check scene that shows continuity.",
    },
  ],
  createdAt: 1,
  updatedAt: 5,
};

function createReadmeWorkspaceFileTree() {
  return {
    ".": [
      { name: "docs", path: "docs", kind: "dir" },
      { name: "packages", path: "packages", kind: "dir" },
      { name: "README.md", path: "README.md", kind: "file" },
      { name: "README.zh-CN.md", path: "README.zh-CN.md", kind: "file" },
    ] satisfies FileNode[],
    docs: [
      { name: "help", path: "docs/help", kind: "dir" },
      { name: "promotion", path: "docs/promotion", kind: "dir" },
    ] satisfies FileNode[],
    "docs/help": [
      { name: "assets", path: "docs/help/assets", kind: "dir" },
      { name: "desktop-guide.md", path: "docs/help/desktop-guide.md", kind: "file" },
    ] satisfies FileNode[],
    "docs/help/assets": [
      {
        name: "screenshot-desktop-workspace-full.png",
        path: "docs/help/assets/screenshot-desktop-workspace-full.png",
        kind: "file",
      },
      {
        name: "screenshot-pc.png",
        path: "docs/help/assets/screenshot-pc.png",
        kind: "file",
      },
      {
        name: "screenshot-mobile.png",
        path: "docs/help/assets/screenshot-mobile.png",
        kind: "file",
      },
    ] satisfies FileNode[],
    packages: [
      { name: "web", path: "packages/web", kind: "dir" },
      { name: "core", path: "packages/core", kind: "dir" },
    ] satisfies FileNode[],
  };
}

function buildReadmeDesktopHeroSeed(context: {
  theme: string;
  locale: "zh" | "en";
  device: "desktop" | "mobile";
}) {
  const fileTreeByPath = createReadmeWorkspaceFileTree();

  return {
    ...context,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    sessions: readmeDesktopSessions,
    paneLayoutByWorkspaceId: {
      [workspace.id]: {
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          {
            id: "hero-left",
            type: "leaf",
            sessionId: "session-readme-hero",
          },
          {
            id: "hero-right",
            type: "leaf",
            sessionId: "session-readme-hero",
          },
        ],
        sessionId: "session-readme-hero",
      },
    },
    fileTreeByWorkspaceId: {
      [workspace.id]: new Map<string, FileNode[]>(Object.entries(fileTreeByPath)),
    },
    gitStateByWorkspaceId: {
      [workspace.id]: readmeDesktopGitStatus,
    },
    gitBranchListByWorkspaceId: {
      [workspace.id]: {
        current: "feature/readme-refresh",
        branches: [
          { name: "feature/readme-refresh", isCurrent: true, isRemote: false },
          { name: "main", isCurrent: false, isRemote: false },
          { name: "origin/main", isCurrent: false, isRemote: true },
        ],
      },
    },
    terminalMetaById: {
      "term-agent-readme-hero": {
        id: "term-agent-readme-hero",
        workspaceId: workspace.id,
        kind: "agent",
        alive: true,
        title: "Codex session",
      },
      "term-shell-readme-hero": {
        id: "term-shell-readme-hero",
        workspaceId: workspace.id,
        kind: "shell",
        alive: true,
        title: "Workspace Shell",
      },
    },
    terminalOutputById: {
      "term-agent-readme-hero": [
        new TextEncoder().encode(
          [
            '$ codex run --model gpt-5.5 --task "refresh readme screenshots"',
            "Analyzing README usage and current preview scenes...",
            "Plan: add README-specific preview scenes, capture desktop hero, capture mobile continuity shot.",
            "",
            "Editing packages/web/src/ui-preview/scenes/showcase-scenes.tsx",
            "Preparing fresh assets in docs/help/assets/",
          ].join("\n")
        ),
      ],
      "term-shell-readme-hero": [
        new TextEncoder().encode(
          [
            "$ pnpm --filter @coder-studio/web exec vitest run src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx",
            "✓ src/ui-preview/scene-metadata.test.ts (9)",
            "✓ src/ui-preview/catalog.test.tsx (35)",
            "",
            '$ pnpm --dir e2e-ui exec playwright test --grep "README /"',
            "capturing desktop hero and mobile progress scenes...",
          ].join("\n")
        ),
      ],
    },
    supervisorBySessionId: {
      "session-readme-hero": readmeSupervisor,
    },
    commands: {
      workspaceList: [workspace],
      sessionListByWorkspaceId: {
        [workspace.id]: readmeDesktopSessions,
      },
      fileTreeByWorkspaceId: {
        [workspace.id]: fileTreeByPath,
      },
      gitStatusByWorkspaceId: {
        [workspace.id]: readmeDesktopGitStatus,
      },
      gitBranchesByWorkspaceId: {
        [workspace.id]: {
          current: "feature/readme-refresh",
          branches: [
            { name: "feature/readme-refresh", isCurrent: true, isRemote: false },
            { name: "main", isCurrent: false, isRemote: false },
            { name: "origin/main", isCurrent: false, isRemote: true },
          ],
        },
      },
      terminalListByWorkspaceId: {
        [workspace.id]: [
          {
            id: "term-shell-readme-hero",
            workspaceId: workspace.id,
            kind: "shell",
            title: "Workspace Shell",
            cwd: workspace.path,
            argv: ["zsh"],
            cols: 120,
            rows: 28,
            alive: true,
            createdAt: 2,
          },
          {
            id: "term-shell-readme-verify",
            workspaceId: workspace.id,
            kind: "shell",
            title: "Preview Runner",
            cwd: workspace.path,
            argv: ["zsh"],
            cols: 120,
            rows: 28,
            alive: true,
            createdAt: 3,
          },
        ],
      },
      supervisorBySessionId: {
        "session-readme-hero": readmeSupervisor,
      },
    },
  };
}

function buildReadmeDesktopReviewSeed(context: {
  theme: string;
  locale: "zh" | "en";
  device: "desktop" | "mobile";
}) {
  const fileTreeByPath = createReadmeWorkspaceFileTree();

  return {
    ...buildReadmeDesktopHeroSeed(context),
    fileTreeByWorkspaceId: {
      [workspace.id]: new Map<string, FileNode[]>(Object.entries(fileTreeByPath)),
    },
    gitDiffPreviewByWorkspaceId: {
      [workspace.id]: {
        path: "packages/web/src/features/topbar/index.tsx",
        title: "README capture polish",
        diff: [
          "diff --git a/packages/web/src/features/topbar/index.tsx b/packages/web/src/features/topbar/index.tsx",
          "@@ Refine the desktop topbar hierarchy",
          '-        <span className=\"topbar-btn-label\">Quick Actions</span>',
          '+        <span className=\"topbar-btn-label\">Quick Actions</span>',
          '+        <span className=\"topbar-btn-hint\">Review README capture targets</span>',
          "",
          "@@ screenshot staging",
          "+      <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />",
        ].join("\n"),
        source: "file" as const,
      },
    },
    commands: {
      ...buildReadmeDesktopHeroSeed(context).commands,
      fileTreeByWorkspaceId: {
        [workspace.id]: fileTreeByPath,
      },
      gitStatusByWorkspaceId: {
        [workspace.id]: readmeDesktopGitStatus,
      },
      gitLogByWorkspaceId: {
        [workspace.id]: { entries: [...readmeDesktopHistory] },
      },
      gitDiffByWorkspaceId: {
        [workspace.id]: {
          diff: [
            "diff --git a/packages/web/src/features/topbar/index.tsx b/packages/web/src/features/topbar/index.tsx",
            "@@ Refine the desktop topbar hierarchy",
            '+  <span className="topbar-btn-hint">Review README capture targets</span>',
            '+  <span className="topbar-btn-hint">Keep the workspace hero readable at README width</span>',
          ].join("\n"),
        },
      },
      gitShowByWorkspaceId: {
        [workspace.id]: {
          diff: "@@ latest commit\n+ refresh README desktop review capture",
        },
      },
      supervisorBySessionId: {
        "session-readme-hero": readmeSupervisor,
      },
    },
  };
}

function ReadmeDesktopReviewWorkspace() {
  return (
    <div className="workspace-page workspace-page--desktop">
      <TopBar />
      <div className="workspace-body">
        <aside className="left-panel" style={{ width: "324px" }}>
          <div className="nav-panel workspace-sidebar-panel">
            <div className="workspace-sidebar-panel__body">
              <GitPanel workspaceId={workspace.id} variant="desktop" />
            </div>
          </div>
        </aside>
        <div className="split-divider-v" aria-hidden="true" />
        <div className="workspace-main-area">
          <div className="workspace-main-stage">
            <GitDiffViewer workspaceId={workspace.id} showCloseButton={false} />
          </div>
        </div>
      </div>
      <WorkspaceStatusBar
        align="start"
        workspaceId={workspace.id}
        gitState={readmeDesktopGitStatus}
      />
    </div>
  );
}

function ReadmeMobileProgressWorkspace() {
  const readmeMobileGitState: GitStatus = {
    branch: "feature/readme-refresh",
    ahead: 2,
    behind: 0,
    staged: [{ path: "README.md", status: "modified" }],
    modified: [{ path: "docs/help/assets/screenshot-mobile.png", status: "modified" }],
    untracked: [],
    deleted: [],
  };

  return (
    <div
      className="mobile-shell mobile-shell--stacked mobile-shell--motion-reduced"
      data-testid="mobile-shell"
    >
      <MobileTopBar
        activeWorkspace={workspace}
        drawerOpen={false}
        onOpenSettings={() => {}}
        onToggleDrawer={() => {}}
      />
      <main className="mobile-shell__viewport">
        <div className="mobile-shell__content" style={{ gap: "12px", paddingBottom: "144px" }}>
          <section className="mobile-shell__agent-stage" style={{ flex: "0 0 420px" }}>
            <SessionCard
              sessionId="session-readme-mobile"
              showHeaderActions={false}
              showSupervisorInline={false}
              headerAccessory={
                <MobileSupervisorBadge sessionId="session-readme-mobile" onOpen={() => {}} />
              }
            />
          </section>
          <section style={{ padding: "0 12px" }}>
            <SupervisorCard sessionId="session-readme-mobile" workspaceId={workspace.id} />
          </section>
        </div>
      </main>
      <div
        className="mobile-shell__bottom-stack"
        data-testid="mobile-bottom-stack"
        style={{ "--mobile-keyboard-inset": "0px" } as CSSProperties}
      >
        <div className="mobile-dock-shell">
          <MobileDock activeItem="agent" onSelectItem={() => {}} />
        </div>
        <WorkspaceStatusBar workspaceId={workspace.id} gitState={readmeMobileGitState} />
      </div>
    </div>
  );
}

function buildReadmeMobileProgressSeed(context: {
  theme: string;
  locale: "zh" | "en";
  device: "desktop" | "mobile";
}) {
  const mobileWorkspace = {
    ...workspace,
    uiState: {
      ...workspace.uiState,
      activeSessionId: "session-readme-mobile",
      paneLayout: {
        id: "root",
        type: "leaf" as const,
        sessionId: "session-readme-mobile",
      },
    },
  };

  return {
    ...context,
    workspaces: [mobileWorkspace],
    activeWorkspaceId: mobileWorkspace.id,
    sessions: readmeMobileSessions,
    paneLayoutByWorkspaceId: {
      [mobileWorkspace.id]: {
        id: "root",
        type: "leaf",
        sessionId: "session-readme-mobile",
      },
    },
    gitStateByWorkspaceId: {
      [mobileWorkspace.id]: {
        branch: "feature/readme-refresh",
        ahead: 2,
        behind: 0,
        staged: [{ path: "README.md", status: "modified" }],
        modified: [{ path: "docs/help/assets/screenshot-mobile.png", status: "modified" }],
        untracked: [],
        deleted: [],
      },
    },
    terminalMetaById: {
      "term-agent-readme-mobile": {
        id: "term-agent-readme-mobile",
        workspaceId: mobileWorkspace.id,
        kind: "agent",
        alive: true,
        title: "Claude progress review",
      },
    },
    terminalOutputById: {
      "term-agent-readme-mobile": [
        new TextEncoder().encode(
          [
            "$ claude review --scene readme-mobile-progress",
            "Checking continuity between desktop hero and mobile status view...",
            "Recommendation: keep supervisor progress visible above the dock.",
            "Status: desktop captures approved, mobile continuity shot queued for export.",
          ].join("\n")
        ),
      ],
    },
    supervisorBySessionId: {
      "session-readme-mobile": readmeMobileSupervisor,
    },
    commands: {
      workspaceList: [mobileWorkspace],
      sessionListByWorkspaceId: {
        [mobileWorkspace.id]: readmeMobileSessions,
      },
      gitStatusByWorkspaceId: {
        [mobileWorkspace.id]: {
          branch: "feature/readme-refresh",
          ahead: 2,
          behind: 0,
          staged: [{ path: "README.md", status: "modified" }],
          modified: [{ path: "docs/help/assets/screenshot-mobile.png", status: "modified" }],
          untracked: [],
          deleted: [],
        },
      },
      gitBranchesByWorkspaceId: {
        [mobileWorkspace.id]: {
          current: "feature/readme-refresh",
          branches: [
            { name: "feature/readme-refresh", isCurrent: true, isRemote: false },
            { name: "main", isCurrent: false, isRemote: false },
          ],
        },
      },
      supervisorBySessionId: {
        "session-readme-mobile": readmeMobileSupervisor,
      },
    },
  };
}

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

function FooterUpdateRailPreviewShell({
  device,
  className,
}: {
  device: "desktop" | "mobile";
  className: string;
}) {
  return device === "mobile" ? (
    <div
      className={`${className} mobile-shell mobile-shell--stacked mobile-shell--motion-reduced`}
      data-testid="mobile-shell"
    >
      <MobileTopBar
        activeWorkspace={workspace}
        drawerOpen={false}
        onOpenSettings={() => {}}
        onToggleDrawer={() => {}}
      />
      <main className="mobile-shell__viewport">
        <div className="mobile-shell__content" style={{ paddingBottom: "144px" }} />
      </main>
      <div
        className="mobile-shell__bottom-stack"
        data-testid="mobile-bottom-stack"
        style={{ "--mobile-keyboard-inset": "0px" } as CSSProperties}
      >
        <div className="mobile-dock-shell">
          <MobileDock activeItem="agent" onSelectItem={() => {}} />
        </div>
        <WorkspaceStatusBar workspaceId={workspace.id} gitState={readmeDesktopGitStatus} />
      </div>
    </div>
  ) : (
    <div className={className}>
      <div className="workspace-page workspace-page--desktop">
        <TopBar />
        <div className="workspace-body">
          <div className="workspace-main-area">
            <div className="workspace-main-stage" />
          </div>
        </div>
        <WorkspaceStatusBar
          align="start"
          workspaceId={workspace.id}
          gitState={readmeDesktopGitStatus}
        />
      </div>
    </div>
  );
}

function FooterUpdateRailConfirmPreview({ device }: { device: "desktop" | "mobile" }) {
  const t = useTranslation();

  return (
    <>
      <FooterUpdateRailPreviewShell className="footer-update-rail-confirm-review" device={device} />
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title={t("settings.about.confirm_update_title")}
        description={
          <div className="settings-dialog-copy">
            <p>{t("settings.about.confirm_update_message")}</p>
            <p>
              {t("settings.about.confirm_update_activity", {
                terminals: 1,
                sessions: 2,
                supervisors: 3,
              })}
            </p>
          </div>
        }
        cancelText={t("action.cancel")}
        confirmText={t("settings.about.update_now")}
        tone="danger"
        onConfirm={() => {}}
      />
    </>
  );
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
    scene("footer-update-rail-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        gitStateByWorkspaceId: {
          [workspace.id]: readmeDesktopGitStatus,
        },
        updateState: footerUpdateRailPreviewState,
      }),
      render: (context) => (
        <FooterUpdateRailPreviewShell
          className="footer-update-rail-review"
          device={context.device}
        />
      ),
    }),
    scene("footer-update-rail-confirm-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        gitStateByWorkspaceId: {
          [workspace.id]: readmeDesktopGitStatus,
        },
        updateState: footerUpdateRailPreviewState,
      }),
      render: (context) => <FooterUpdateRailConfirmPreview device={context.device} />,
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
                    <ThemedIcon semantic="file.folder.closed" size={14} />
                  </span>
                  <span>packages</span>
                </div>
                <div className="tree-item">
                  <span className="tree-icon code" aria-hidden="true">
                    <ThemedIcon semantic="file.type.code" size={14} />
                  </span>
                  <span>app.tsx</span>
                </div>
                <div className="tree-item">
                  <span className="tree-icon data" aria-hidden="true">
                    <ThemedIcon semantic="file.type.data" size={14} />
                  </span>
                  <span>theme.json</span>
                </div>
                <div className="tree-item">
                  <span className="tree-icon doc" aria-hidden="true">
                    <ThemedIcon semantic="file.type.doc" size={14} />
                  </span>
                  <span>README.md</span>
                </div>
              </div>
              <EmptyState
                className="bottom-terminal-empty"
                description={
                  <p className="bottom-terminal-empty-hint">
                    Review the terminal empty-state icon and surface treatment.
                  </p>
                }
                icon={
                  <ThemedIcon
                    className="bottom-terminal-empty-icon"
                    semantic="state.emptyTerminal"
                    size={32}
                  />
                }
                title={<p className="bottom-terminal-empty-text">No terminal session</p>}
              />
              <MobileDock activeItem="files" onSelectItem={() => {}} />
            </div>
          </div>
        ) : (
          <div className="workspace-icon-review">
            <div className="file-tree-shell">
              <div className="tree-item">
                <span className="tree-icon folder" aria-hidden="true">
                  <ThemedIcon semantic="file.folder.closed" size={14} />
                </span>
                <span>packages</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon code" aria-hidden="true">
                  <ThemedIcon semantic="file.type.code" size={14} />
                </span>
                <span>app.tsx</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon data" aria-hidden="true">
                  <ThemedIcon semantic="file.type.data" size={14} />
                </span>
                <span>theme.json</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon doc" aria-hidden="true">
                  <ThemedIcon semantic="file.type.doc" size={14} />
                </span>
                <span>README.md</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon media" aria-hidden="true">
                  <ThemedIcon semantic="file.type.media" size={14} />
                </span>
                <span>logo.png</span>
              </div>
              <div className="tree-item">
                <span className="tree-icon file" aria-hidden="true">
                  <ThemedIcon semantic="file.type.default" size={14} />
                </span>
                <span>LICENSE</span>
              </div>
            </div>
            <div className="git-panel">
              <div className="git-row">
                <span className="git-row-icon git-row-icon-staged" aria-hidden="true">
                  <ThemedIcon semantic="git.status.staged" size={12} />
                </span>
                <span>staged.ts</span>
              </div>
              <div className="git-row">
                <span className="git-row-icon git-row-icon-modified" aria-hidden="true">
                  <ThemedIcon semantic="git.status.modified" size={12} />
                </span>
                <span>modified.ts</span>
              </div>
              <div className="git-row">
                <span className="git-row-icon git-row-icon-deleted" aria-hidden="true">
                  <ThemedIcon semantic="git.status.deleted" size={12} />
                </span>
                <span>deleted.ts</span>
              </div>
              <div className="git-row">
                <span className="git-row-icon git-row-icon-untracked" aria-hidden="true">
                  <ThemedIcon semantic="git.status.untracked" size={12} />
                </span>
                <span>untracked.ts</span>
              </div>
            </div>
            <EmptyState
              className="bottom-terminal-empty"
              description={
                <p className="bottom-terminal-empty-hint">
                  Review the terminal empty-state icon and surface treatment.
                </p>
              }
              icon={
                <ThemedIcon
                  className="bottom-terminal-empty-icon"
                  semantic="state.emptyTerminal"
                  size={32}
                />
              }
              title={<p className="bottom-terminal-empty-text">No terminal session</p>}
            />
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
          mode: "edit",
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
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        commands: {
          fileTreeByWorkspaceId: {
            [workspace.id]: {
              ".": fileTreeRoot,
              packages: fileTreePackages,
            },
          },
          gitStatusByWorkspaceId: {
            [workspace.id]: {
              branch: "feature/mobile-polish",
              ahead: 2,
              behind: 0,
              staged: [{ path: "packages/web/src/styles/components.css", status: "modified" }],
              modified: [
                {
                  path: "packages/web/src/features/settings/components/settings-page.tsx",
                  status: "modified",
                },
                {
                  path: "packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx",
                  status: "modified",
                },
              ],
              untracked: [{ path: "e2e-ui/output/mobile-review.png", status: "untracked" }],
              deleted: [],
            },
          },
          gitBranchesByWorkspaceId: {
            [workspace.id]: {
              current: "feature/mobile-polish",
              branches: [
                { name: "feature/mobile-polish", isCurrent: true, isRemote: false },
                { name: "develop", isCurrent: false, isRemote: false },
              ],
            },
          },
          terminalListByWorkspaceId: {
            [workspace.id]: [],
          },
        },
      }),
      render: () => (
        <Sheet
          title="Explorer"
          kicker="Workspace"
          fullscreen
          bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen"
          contentClassName="mobile-sheet--files"
          onClose={() => {}}
          body={
            <MobileFilesSheet
              workspaceId={workspace.id}
              route={{ kind: "root" }}
              activeView="explorer"
            />
          }
        />
      ),
    }),
    scene("mobile-terminal-sheet", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        terminalMetaById: {
          "term-preview-1": {
            id: "term-preview-1",
            workspaceId: workspace.id,
            kind: "shell",
            alive: true,
            title: "Workspace Shell",
          },
          "term-preview-2": {
            id: "term-preview-2",
            workspaceId: workspace.id,
            kind: "shell",
            alive: true,
            title: "Preview Runner",
          },
        },
        terminalOutputById: {
          "term-preview-1": [new TextEncoder().encode("$ pnpm --filter @coder-studio/web test\n")],
          "term-preview-2": [new TextEncoder().encode("$ playwright test --project=mobile\n")],
        },
        commands: {
          terminalListByWorkspaceId: {
            [workspace.id]: [
              {
                id: "term-preview-1",
                workspaceId: workspace.id,
                kind: "shell",
                title: "Workspace Shell",
                cwd: workspace.path,
                argv: ["zsh"],
                cols: 120,
                rows: 28,
                alive: true,
                createdAt: 1,
              },
              {
                id: "term-preview-2",
                workspaceId: workspace.id,
                kind: "shell",
                title: "Preview Runner",
                cwd: workspace.path,
                argv: ["zsh"],
                cols: 120,
                rows: 28,
                alive: true,
                createdAt: 2,
              },
            ],
          },
        },
      }),
      render: () => {
        const MobileTerminalPreviewSheet = () => {
          const [headerAction, setHeaderAction] = useState<ReactNode>(null);

          return (
            <Sheet
              title="Terminal"
              kicker={null}
              fullscreen
              bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen"
              contentClassName="mobile-sheet--terminal"
              headerAction={headerAction}
              onClose={() => {}}
              body={
                <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
                  <TerminalPanel
                    chrome="mobile-fullscreen"
                    onMobileHeaderActionsChange={setHeaderAction}
                  />
                </div>
              }
              footer={
                <WorkspaceStatusBar
                  workspaceId={workspace.id}
                  gitState={{
                    branch: "feature/mobile-terminal",
                    ahead: 0,
                    behind: 0,
                    staged: [],
                    modified: [
                      { path: "packages/web/src/styles/components.css", status: "modified" },
                    ],
                    untracked: [],
                    deleted: [],
                  }}
                  flush
                />
              }
            />
          );
        };

        return <MobileTerminalPreviewSheet />;
      },
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
    scene("readme-desktop-hero", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildReadmeDesktopHeroSeed(context),
      render: () => <WorkspaceDesktopView />,
    }),
    scene("readme-desktop-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildReadmeDesktopReviewSeed(context),
      render: () => <ReadmeDesktopReviewWorkspace />,
    }),
    scene("readme-mobile-progress", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildReadmeMobileProgressSeed({ ...context, device: "mobile" }),
      render: () => <ReadmeMobileProgressWorkspace />,
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
