import {
  deriveMonitoringMode,
  type FileNode,
  type GitStatus,
  type MonitoringResponse,
  type ProviderListItem,
  type ProviderRuntimeStatusResponse,
  type SearchSessionStartResult,
  type Session,
  type Workspace,
} from "@coder-studio/core";
import { lazy, Suspense } from "react";
import { LoginPage } from "../../features/auth";
import { SessionGatePage } from "../../features/auth/session-gate";
import { NotFoundPage } from "../../features/not-found";
import { SettingsPage } from "../../features/settings";
import { WelcomePage } from "../../features/welcome";
import type { OpenFile } from "../../features/workspace/atoms";
import { WorkspaceEmptyState } from "../../features/workspace/views/shared/workspace-empty-state";
import { WorkspaceRouteGate } from "../../features/workspace/views/shared/workspace-route-gate";
import { DesktopShell } from "../../shells/desktop-shell";
import { MobileShell } from "../../shells/mobile-shell";
import type { UiPreviewSceneContext, UiPreviewSceneDefinition } from "../catalog";
import { getUiPreviewSceneMetadata } from "../scene-metadata";

const DeferredMoreFeaturesPage = lazy(async () => {
  const module = await import("../../features/more");
  return { default: module.MoreFeaturesPage };
});

const DeferredWorkspaceDesktopView = lazy(async () => {
  const module = await import("../../features/workspace/views/desktop/workspace-desktop-view");
  return { default: module.WorkspaceDesktopView };
});

const DeferredWorkspaceMobileView = lazy(async () => {
  const module = await import("../../features/workspace/views/mobile/workspace-mobile-view");
  return { default: module.WorkspaceMobileView };
});

const workspace: Workspace = {
  id: "ws-preview",
  name: "coder-studio",
  path: "/home/spencer/workspace/coder-studio",
  targetRuntime: "native",
  openedAt: 1,
  lastActiveAt: 1,
  uiState: {
    leftPanelWidth: 402,
    bottomPanelHeight: 220,
    focusMode: false,
    fileTreeExpandedDirs: [],
    paneLayout: { id: "root", type: "leaf" },
  },
};

const gitStatus: GitStatus = {
  branch: "feature/ai-agent",
  ahead: 0,
  behind: 0,
  staged: [],
  modified: [
    { path: "packages/web/src/app.tsx", status: "modified" },
    {
      path: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
      status: "modified",
    },
    { path: "packages/web/src/styles/components.css", status: "modified" },
  ],
  untracked: [{ path: "e2e-ui/src/index.ts", status: "untracked" }],
  deleted: [],
};

const previewProviderList: ProviderListItem[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    badge: "Claude",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["claude"],
  },
  {
    id: "codex",
    displayName: "Codex",
    badge: "Codex",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["codex"],
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    badge: "Gemini",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["gemini"],
  },
  {
    id: "cursor",
    displayName: "Cursor Agent",
    badge: "Cursor",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["agent"],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    badge: "OpenCode",
    kind: "built_in",
    stability: "experimental",
    capability: "limited",
    capabilities: [],
    requiredCommands: ["opencode"],
  },
];

const previewProviderRuntimeStatus: ProviderRuntimeStatusResponse["providers"] = {
  claude: {
    providerId: "claude",
    displayName: "Claude Code",
    badge: "Claude",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["claude"],
    available: true,
    missingCommands: [],
    missingPrerequisites: [],
    autoInstallSupported: true,
    installReadiness: "ready",
    manualGuideKeys: [],
    docUrls: { provider: "", prerequisites: {} },
  },
  codex: {
    providerId: "codex",
    displayName: "Codex",
    badge: "Codex",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["codex"],
    available: true,
    missingCommands: [],
    missingPrerequisites: [],
    autoInstallSupported: true,
    installReadiness: "ready",
    manualGuideKeys: [],
    docUrls: { provider: "", prerequisites: {} },
  },
  gemini: {
    providerId: "gemini",
    displayName: "Gemini CLI",
    badge: "Gemini",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["gemini"],
    available: true,
    missingCommands: [],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: "ready",
    manualGuideKeys: [],
    docUrls: { provider: "", prerequisites: {} },
  },
  cursor: {
    providerId: "cursor",
    displayName: "Cursor Agent",
    badge: "Cursor",
    kind: "built_in",
    stability: "stable",
    capability: "full",
    capabilities: [],
    requiredCommands: ["agent"],
    available: true,
    missingCommands: [],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: "ready",
    manualGuideKeys: [],
    docUrls: { provider: "", prerequisites: {} },
  },
  opencode: {
    providerId: "opencode",
    displayName: "OpenCode",
    badge: "OpenCode",
    kind: "built_in",
    stability: "experimental",
    capability: "limited",
    capabilities: [],
    requiredCommands: ["opencode"],
    available: false,
    missingCommands: ["opencode"],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: "unsupported_platform",
    manualGuideKeys: [],
    docUrls: { provider: "", prerequisites: {} },
  },
};

const previewSkillTargets = [
  {
    providerId: "codex",
    displayName: "Codex",
    kind: "built_in" as const,
    skillDir: "/Users/spencer/.codex/skills",
    mountPreference: "auto" as const,
    lastHealthState: "healthy" as const,
    mountedSkillCount: 2,
  },
  {
    providerId: "claude",
    displayName: "Claude Code",
    kind: "built_in" as const,
    skillDir: "/Users/spencer/.claude/skills",
    mountPreference: "auto" as const,
    lastHealthState: "healthy" as const,
    mountedSkillCount: 1,
  },
  {
    providerId: "gemini",
    displayName: "Gemini CLI",
    kind: "built_in" as const,
    mountPreference: "auto" as const,
    lastHealthState: "unconfigured" as const,
    mountedSkillCount: 0,
  },
];

const previewSkillMounts = [
  {
    providerId: "codex",
    skillSlug: "frontend-design",
    enabled: true,
    sourcePath: "/Users/spencer/.coder-studio/skills/frontend-design",
    targetPath: "/Users/spencer/.codex/skills/frontend-design",
    mountModeResolved: "symlink" as const,
    status: "mounted" as const,
    lastSyncedAt: 1715731200000,
  },
  {
    providerId: "claude",
    skillSlug: "frontend-design",
    enabled: false,
    sourcePath: "/Users/spencer/.coder-studio/skills/frontend-design",
    targetPath: "/Users/spencer/.claude/skills/frontend-design",
    mountModeResolved: "symlink" as const,
    status: "mounted" as const,
    lastSyncedAt: 1715731200000,
  },
];

const previewSkillsLibrary = [
  {
    slug: "frontend-design",
    displayName: "Frontend Design",
    description: "Design and verify production frontend UI changes in the workspace.",
    version: "1.4.0",
    source: "installed" as const,
    origin: "skillhub" as const,
    libraryPath: "/Users/spencer/.coder-studio/state/skills/library/frontend-design",
    installState: "installed" as const,
    installedAt: 1715731200000,
    updatedAt: 1715731200000,
    mountedProviderIds: ["codex"],
    mountStatus: "partially_mounted" as const,
    errorCount: 0,
  },
];

const previewCustomSkillsLibrary = [
  {
    slug: "review-ops-skill",
    displayName: "Review Ops Skill",
    description: "Run structured acceptance and rollout checks before shipping a change.",
    version: "local",
    source: "custom" as const,
    origin: "filesystem" as const,
    libraryPath: "/Users/spencer/.coder-studio/state/skills/custom/review-ops-skill",
    installState: "installed" as const,
    installedAt: 1715731200000,
    updatedAt: 1715731200000,
    mountedProviderIds: ["codex", "claude"],
    mountStatus: "fully_mounted" as const,
    errorCount: 0,
  },
  {
    slug: "session-audit-helper",
    displayName: "Session Audit Helper",
    description: "Inspect long-running sessions and summarize follow-up actions for handoff.",
    version: "local",
    source: "custom" as const,
    origin: "filesystem" as const,
    libraryPath: "/Users/spencer/.coder-studio/state/skills/custom/session-audit-helper",
    installState: "installed" as const,
    installedAt: 1715731200000,
    updatedAt: 1715731200000,
    mountedProviderIds: ["codex"],
    mountStatus: "partially_mounted" as const,
    errorCount: 0,
  },
];

const previewCustomSkillMounts = [
  {
    providerId: "codex",
    skillSlug: "review-ops-skill",
    enabled: true,
    sourcePath: "/Users/spencer/.coder-studio/state/skills/custom/review-ops-skill",
    targetPath: "/Users/spencer/.codex/skills/review-ops-skill",
    mountModeResolved: "symlink" as const,
    status: "mounted" as const,
    lastSyncedAt: 1715731200000,
  },
  {
    providerId: "claude",
    skillSlug: "review-ops-skill",
    enabled: true,
    sourcePath: "/Users/spencer/.coder-studio/state/skills/custom/review-ops-skill",
    targetPath: "/Users/spencer/.claude/skills/review-ops-skill",
    mountModeResolved: "symlink" as const,
    status: "mounted" as const,
    lastSyncedAt: 1715731200000,
  },
  {
    providerId: "codex",
    skillSlug: "session-audit-helper",
    enabled: true,
    sourcePath: "/Users/spencer/.coder-studio/state/skills/custom/session-audit-helper",
    targetPath: "/Users/spencer/.codex/skills/session-audit-helper",
    mountModeResolved: "symlink" as const,
    status: "mounted" as const,
    lastSyncedAt: 1715731200000,
  },
];

const previewCustomSkillFiles = {
  "review-ops-skill": [
    {
      path: "SKILL.md",
      kind: "file" as const,
      content: [
        "---",
        "name: review-ops-skill",
        "description: Acceptance and rollout reviewer",
        "---",
        "",
        "# Review Ops Skill",
        "",
        "Use this skill to verify acceptance, rollout safety, and release readiness.",
        "",
        "- Review the changed files",
        "- Verify tests and screenshots",
        "- Summarize launch risks",
        "",
      ].join("\n"),
    },
    { path: "refs", kind: "dir" as const },
    {
      path: "refs/checklist.md",
      kind: "file" as const,
      content: [
        "# Acceptance Checklist",
        "",
        "- Confirm core flow",
        "- Capture screenshots",
        "- Note residual risk",
        "",
      ].join("\n"),
    },
    { path: "templates", kind: "dir" as const },
    {
      path: "templates/report.md",
      kind: "file" as const,
      content: ["# Release Report", "", "## Summary", "", "- Pending", ""].join("\n"),
    },
  ],
  "session-audit-helper": [
    {
      path: "SKILL.md",
      kind: "file" as const,
      content: [
        "---",
        "name: session-audit-helper",
        "description: Session audit helper",
        "---",
        "",
        "# Session Audit Helper",
        "",
        "Audit recent sessions and capture next steps.",
        "",
      ].join("\n"),
    },
    { path: "refs", kind: "dir" as const },
    {
      path: "refs/summary.md",
      kind: "file" as const,
      content: "# Summary\n",
    },
  ],
};

const fileTreeMap = new Map<string, FileNode[]>();
fileTreeMap.set(".", [
  { name: "packages", path: "packages", kind: "dir" },
  { name: "core", path: "core", kind: "dir" },
  { name: "README.md", path: "README.md", kind: "file" },
]);

const openPreviewFiles: Record<string, OpenFile> = {
  "packages/web/src/features/code-editor/views/shared/editor-surface.tsx": {
    kind: "text",
    path: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
    content: [
      'export const EditorSurface: FC<EditorSurfaceProps> = ({ state, chrome = "full" }) => {',
      "  const { t } = useTranslation();",
      "  const { activeFilePath, openFiles, openEditorPaths } = state;",
      "",
      "  const visibleEditorPaths = mergeOpenEditorPaths(openEditorPaths, Object.keys(openFiles));",
      "",
      "  return (",
      '    <header className="editor-surface__header editor-surface__header--tabs">',
      '      <div className="code-editor-tabbar">',
      '      <div className="code-editor-tabs" role="tablist">',
      "        {visibleEditorPaths.map((path) => {",
      "          const fileName = getFileName(path);",
      "          return (",
      '          <button key={path} type="button" role="tab" aria-selected={path === activeFilePath}>',
      '            <span className="code-editor-tab__name">{fileName}</span>',
      "          </button>",
      "          );",
      "        })}",
      "      </div>",
      "      <CodeEditorDesktopHeaderActions showModeActions={false} />",
      "      </div>",
      "    </header>",
      "  );",
      "};",
    ].join("\n"),
    savedContent: [
      "export const EditorSurface: FC<EditorSurfaceProps> = ({ state }) => {",
      "  return <CodeEditorHost state={state} />;",
      "};",
    ].join("\n"),
    baseHash: "preview:editor-surface-tsx",
    isDirty: true,
  },
  "packages/web/src/features/code-editor/views/shared/code-editor-host.tsx": {
    kind: "text",
    path: "packages/web/src/features/code-editor/views/shared/code-editor-host.tsx",
    content: [
      "export const CodeEditorDesktopHeaderActions: FC<Props> = ({ state, onRequestClose }) => {",
      "  return (",
      '    <div className="editor-surface__toolbar" role="toolbar">',
      '      <IconButton icon={<PencilLine size={14} />} aria-label={t("code_editor.mode_edit")} />',
      '      <IconButton icon={<GitCompareArrows size={14} />} aria-label={t("code_editor.mode_diff")} />',
      '      <IconButton icon={<Eye size={14} />} aria-label={t("code_editor.mode_preview")} />',
      '      <IconButton icon={<X size={14} />} aria-label={t("code_editor.close_editor_view")} />',
      "    </div>",
      "  );",
      "};",
    ].join("\n"),
    savedContent: [
      "export const CodeEditorDesktopHeaderActions: FC<Props> = ({ state, onRequestClose }) => {",
      "  return <EditorToolbar state={state} onClose={onRequestClose} />;",
      "};",
    ].join("\n"),
    baseHash: "preview:code-editor-host-tsx",
    isDirty: false,
  },
  "packages/web/src/styles/components.css": {
    kind: "text",
    path: "packages/web/src/styles/components.css",
    content: [
      ".editor-surface__header--tabs {",
      "  flex-direction: column;",
      "  gap: 0;",
      "  padding: 0;",
      "}",
      "",
      ".code-editor-tabs {",
      "  display: flex;",
      "  min-height: 34px;",
      "  overflow-x: auto;",
      "  border-bottom: 1px solid var(--workspace-editor-toolbar-border);",
      "}",
      "",
      ".code-editor-tab {",
      "  width: 196px;",
      "  border-radius: 0;",
      "}",
    ].join("\n"),
    savedContent: [
      ".code-editor-tabs {",
      "  display: flex;",
      "  min-height: 34px;",
      "  border-bottom: 1px solid var(--workspace-editor-toolbar-border);",
      "}",
    ].join("\n"),
    baseHash: "preview:components-css",
    isDirty: true,
  },
  "packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx": {
    kind: "text",
    path: "packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx",
    content: [
      "export function WorkspaceDesktopView() {",
      "  return (",
      "    <WorkspaceShell>",
      "      <AgentPanes />",
      "      <BottomPanel />",
      "    </WorkspaceShell>",
      "  );",
      "}",
    ].join("\n"),
    savedContent: [
      "export function WorkspaceDesktopView() {",
      "  return <WorkspaceShell />;",
      "}",
    ].join("\n"),
    baseHash: "preview:workspace-desktop-view-tsx",
    isDirty: false,
  },
  "packages/web/src/features/code-editor/actions/use-code-editor-actions.ts": {
    kind: "text",
    path: "packages/web/src/features/code-editor/actions/use-code-editor-actions.ts",
    content: [
      "export function useCodeEditorActions(options: CodeEditorActionsOptions = {}) {",
      "  const [activeFilePath, setActiveFilePath] = useAtom(activeFilePathAtom);",
      "  const openEditorPaths = useAtomValue(openEditorPathsAtomFamily(workspaceId));",
      "",
      "  const activateOpenFile = useCallback((path: string) => {",
      "    setActiveFilePath(path);",
      "    void persistUiState({ activeEditorPath: path });",
      "  }, [persistUiState, setActiveFilePath]);",
      "",
      "  return { activeFilePath, openEditorPaths, activateOpenFile };",
      "}",
    ].join("\n"),
    savedContent: [
      "export function useCodeEditorActions(options: CodeEditorActionsOptions = {}) {",
      "  return useEditorActions(options);",
      "}",
    ].join("\n"),
    baseHash: "preview:use-code-editor-actions-ts",
    isDirty: false,
  },
  "packages/web/src/features/workspace/index.tsx": {
    kind: "text",
    path: "packages/web/src/features/workspace/index.tsx",
    content: [
      'export { WorkspaceDesktopView } from "./views/desktop/workspace-desktop-view";',
      'export { WorkspaceMobileView } from "./views/mobile/workspace-mobile-view";',
    ].join("\n"),
    savedContent: [
      'export { WorkspaceDesktopView } from "./views/desktop/workspace-desktop-view";',
      'export { WorkspaceMobileView } from "./views/mobile/workspace-mobile-view";',
    ].join("\n"),
    baseHash: "preview:workspace-index-tsx",
    isDirty: false,
  },
  "packages/web/src/locales/zh.json": {
    kind: "text",
    path: "packages/web/src/locales/zh.json",
    content: [
      "{",
      '  "code_editor": {',
      '    "open_editor_tabs": "打开的编辑器标签",',
      '    "current_file_path": "当前文件路径",',
      '    "close_editor_view": "关闭编辑器视图"',
      "  }",
      "}",
    ].join("\n"),
    savedContent: [
      "{",
      '  "code_editor": {',
      '    "open_editor_tabs": "打开的编辑器标签"',
      "  }",
      "}",
    ].join("\n"),
    baseHash: "preview:zh-json",
    isDirty: false,
  },
};

const editorPanePreviewFiles: Record<string, OpenFile> = {
  "packages/web/src/app.tsx": {
    kind: "text",
    path: "packages/web/src/app.tsx",
    content: [
      "export function App() {",
      "  const searchQuery = workspacePanelState.query;",
      "",
      "  if (!searchQuery.trim()) {",
      "    return null;",
      "  }",
      "",
      "  return <WorkspacePage />;",
      "}",
    ].join("\n"),
    savedContent: [
      "export function App() {",
      "  const searchQuery = workspacePanelState.query;",
      "",
      "  if (!searchQuery.trim()) {",
      "    return null;",
      "  }",
      "",
      "  return <WorkspacePage />;",
      "}",
    ].join("\n"),
    baseHash: "preview:app-tsx",
    isDirty: false,
  },
};

const searchContentResults: SearchSessionStartResult = {
  sessionId: "preview-search-session",
  files: [
    {
      path: "packages/web/src/app.tsx",
      name: "app.tsx",
      matchCount: 4,
      hasMoreMatches: false,
      matches: [
        {
          line: 24,
          id: "preview-match-1",
          column: 7,
          endColumn: 18,
          preview: "const searchQuery = workspacePanelState.query;",
          previewColumnStart: 7,
          previewColumnEnd: 18,
          replacementPreview: "const workspaceQuery = workspacePanelState.query;",
          replacementPreviewColumnStart: 7,
          replacementPreviewColumnEnd: 21,
          isReplacementPreviewTruncated: false,
        },
        {
          line: 86,
          id: "preview-match-2",
          column: 8,
          endColumn: 19,
          preview: "return searchQuery.trim() ? results : [];",
          previewColumnStart: 8,
          previewColumnEnd: 19,
          replacementPreview: "return workspaceQuery.trim() ? results : [];",
          replacementPreviewColumnStart: 8,
          replacementPreviewColumnEnd: 22,
          isReplacementPreviewTruncated: false,
        },
      ],
    },
    {
      baseHash: "preview:tree-tsx",
      path: "packages/web/src/tree.tsx",
      name: "tree.tsx",
      matchCount: 2,
      hasMoreMatches: false,
      matches: [],
    },
  ],
  totalMatchCount: 12,
  totalFileCount: 2,
  hasMoreFiles: false,
  truncatedMatchFileCount: 0,
  skippedBinaryFileCount: 0,
  skippedLargeFileCount: 0,
};

const draftPaneEditorReviewFileContents = {
  "README.md": {
    content: [
      "# Coder Studio",
      "",
      "Use the draft pane to open a file directly into an editor pane.",
      "",
      "- Drop a workspace file onto the draft pane.",
      "- Keep later file opens routed into the focused editor pane.",
      "- Close the editor pane to return the leaf back to draft.",
      "",
      "This preview exists only for acceptance capture.",
    ].join("\n"),
    baseHash: "preview:readme",
  },
  "packages/web/src/app.tsx": {
    content: [
      "export function App() {",
      "  const searchQuery = workspacePanelState.query;",
      "",
      "  if (!searchQuery.trim()) {",
      "    return null;",
      "  }",
      "",
      "  return <WorkspacePage />;",
      "}",
    ].join("\n"),
    baseHash: "preview:app-tsx",
  },
  "packages/web/src/tree.tsx": {
    content: [
      "export function TreePreview() {",
      "  return searchQuery.trim() ? results : [];",
      "}",
    ].join("\n"),
    baseHash: "preview:tree-tsx",
  },
} as const;

const monitoringSampledAt = Date.UTC(2026, 4, 27, 14, 27, 49);

function monitoringSeries(cpuValues: number[], memoryValues: number[]) {
  return {
    points: cpuValues.map((cpuPercent, index) => ({
      sampledAt: monitoringSampledAt - (cpuValues.length - 1 - index) * 30_000,
      cpuPercent,
      memoryBytes: memoryValues[index] ?? memoryValues[memoryValues.length - 1] ?? null,
    })),
  };
}

function buildSettingsSeed(context: UiPreviewSceneContext) {
  const monitoringSettings = {
    enabled: true,
    hostMetricsEnabled: true,
    runtimeSummaryEnabled: true,
    workspaceAttributionEnabled: true,
    subprocessDrilldownEnabled: true,
    sampleIntervalMs: 10000 as const,
  };
  const monitoringWorkspace = {
    id: "workspace:observability",
    kind: "workspace" as const,
    label: "workspace/coder-studio-observability-dashboard-long-name-preview",
    cpuPercent: 7.6,
    memoryBytes: 29.7 * 1024 ** 3,
    processCount: 4,
    uptimeSec: 139 * 60 * 60,
    trend: "steady" as const,
  };
  const monitoringSessions = [
    {
      id: "session:review-agent",
      parentId: "workspace:observability",
      kind: "session" as const,
      label: "session/review-agent",
      cpuPercent: 1.4,
      memoryBytes: 630 * 1024 ** 2,
      processCount: 1,
      uptimeSec: 42 * 60,
      trend: "steady" as const,
    },
    {
      id: "session:build-runner",
      parentId: "workspace:observability",
      kind: "session" as const,
      label: "session/build-runner",
      cpuPercent: 0.4,
      memoryBytes: 92 * 1024 ** 2,
      processCount: 1,
      uptimeSec: 17 * 60,
      trend: "falling" as const,
    },
  ];
  const monitoringSubprocessGroups = [
    {
      id: "subprocess:vite-dev-server",
      parentId: "session:review-agent",
      kind: "subprocess_group" as const,
      label: "vite dev server",
      cpuPercent: 0.4,
      memoryBytes: 92 * 1024 ** 2,
      processCount: 1,
      uptimeSec: 17 * 60,
      trend: "steady" as const,
    },
    {
      id: "subprocess:preview-store-watcher",
      parentId: "session:review-agent",
      kind: "subprocess_group" as const,
      label: "preview store watcher",
      cpuPercent: 0.2,
      memoryBytes: 54 * 1024 ** 2,
      processCount: 1,
      uptimeSec: 11 * 60,
      trend: "steady" as const,
    },
    {
      id: "subprocess:drilldown-guide",
      parentId: "session:build-runner",
      kind: "subprocess_group" as const,
      label: "drilldown entry guide",
      cpuPercent: 0.1,
      memoryBytes: 28 * 1024 ** 2,
      processCount: 1,
      uptimeSec: 5 * 60,
      trend: "steady" as const,
    },
  ];
  const monitoringResponse: MonitoringResponse = {
    settings: monitoringSettings,
    snapshot: {
      sampledAt: monitoringSampledAt,
      mode: deriveMonitoringMode(monitoringSettings),
      host: {
        cpuPercent: 7.6,
        memoryUsedBytes: 29.7 * 1024 ** 3,
        memoryTotalBytes: 63.8 * 1024 ** 3,
        memoryAvailableBytes: 34.1 * 1024 ** 3,
        loadAverage: [0.62, 0.54, 0.49],
        uptimeSec: 139 * 60 * 60,
        pressure: "normal",
      },
      runtime: {
        serverCpuPercent: 0.8,
        serverMemoryBytes: 182 * 1024 ** 2,
        totalManagedCpuPercent: 2.1,
        totalManagedMemoryBytes: 814 * 1024 ** 2,
        managedProcessCount: 4,
        cpuShareOfHostPercent: 0.0,
        memoryShareOfHostPercent: 0.0,
      },
      workspaces: [monitoringWorkspace],
      sessions: monitoringSessions,
      subprocessGroups: monitoringSubprocessGroups,
      backgroundGroups: [],
    },
    history: {
      host: {
        points: Array.from({ length: 30 }, (_, index) => ({
          sampledAt: monitoringSampledAt - (29 - index) * 30_000,
          cpuPercent:
            [
              9, 6, 8, 7, 7, 6, 7, 9, 8, 7, 8, 6, 5, 12, 7, 9, 8, 16, 11, 10, 8, 7, 6, 8, 7, 6, 5,
              9, 4, 7,
            ][index] ?? 7,
          memoryBytes: (29 + (index % 3)) * 1024 ** 3,
        })),
      },
      runtime: {
        points: Array.from({ length: 30 }, (_, index) => ({
          sampledAt: monitoringSampledAt - (29 - index) * 30_000,
          cpuPercent: [0.8, 0.5, 0.9, 1.1, 0.7, 1.4, 1.9, 1.3, 1.7, 2.1][index % 10] ?? 1.2,
          memoryBytes: (760 + (index % 5) * 14) * 1024 ** 2,
          processCount: 4,
        })),
      },
      workspaces: {
        "workspace:observability": monitoringSeries(
          [5.2, 4.1, 6.3, 5.4, 7.8, 6.6, 7.1, 5.5, 6.4, 7.6],
          [
            28.4 * 1024 ** 3,
            28.7 * 1024 ** 3,
            28.9 * 1024 ** 3,
            29.1 * 1024 ** 3,
            29.3 * 1024 ** 3,
            29.5 * 1024 ** 3,
            29.4 * 1024 ** 3,
            29.6 * 1024 ** 3,
            29.7 * 1024 ** 3,
            29.7 * 1024 ** 3,
          ]
        ),
      },
      sessions: {
        "session:review-agent": monitoringSeries(
          [0.9, 1.2, 1.0, 1.5, 1.3, 1.8, 1.7, 1.4, 1.6, 1.4],
          [
            580 * 1024 ** 2,
            590 * 1024 ** 2,
            602 * 1024 ** 2,
            608 * 1024 ** 2,
            618 * 1024 ** 2,
            624 * 1024 ** 2,
            628 * 1024 ** 2,
            631 * 1024 ** 2,
            633 * 1024 ** 2,
            630 * 1024 ** 2,
          ]
        ),
        "session:build-runner": monitoringSeries(
          [0.8, 0.7, 0.6, 0.6, 0.5, 0.5, 0.4, 0.4, 0.4, 0.4],
          [
            118 * 1024 ** 2,
            112 * 1024 ** 2,
            107 * 1024 ** 2,
            104 * 1024 ** 2,
            101 * 1024 ** 2,
            98 * 1024 ** 2,
            96 * 1024 ** 2,
            94 * 1024 ** 2,
            93 * 1024 ** 2,
            92 * 1024 ** 2,
          ]
        ),
      },
      subprocessGroups: {
        "subprocess:vite-dev-server": monitoringSeries(
          [0.5, 0.3, 0.4, 0.6, 0.5, 0.4, 0.6, 0.5, 0.4, 0.4],
          [
            88 * 1024 ** 2,
            89 * 1024 ** 2,
            90 * 1024 ** 2,
            92 * 1024 ** 2,
            93 * 1024 ** 2,
            92 * 1024 ** 2,
            94 * 1024 ** 2,
            93 * 1024 ** 2,
            92 * 1024 ** 2,
            92 * 1024 ** 2,
          ]
        ),
        "subprocess:preview-store-watcher": monitoringSeries(
          [0.2, 0.2, 0.1, 0.3, 0.2, 0.2, 0.2, 0.1, 0.2, 0.2],
          [
            50 * 1024 ** 2,
            51 * 1024 ** 2,
            52 * 1024 ** 2,
            54 * 1024 ** 2,
            54 * 1024 ** 2,
            55 * 1024 ** 2,
            55 * 1024 ** 2,
            54 * 1024 ** 2,
            54 * 1024 ** 2,
            54 * 1024 ** 2,
          ]
        ),
        "subprocess:drilldown-guide": monitoringSeries(
          [0.2, 0.2, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1],
          [
            24 * 1024 ** 2,
            25 * 1024 ** 2,
            25 * 1024 ** 2,
            26 * 1024 ** 2,
            27 * 1024 ** 2,
            27 * 1024 ** 2,
            28 * 1024 ** 2,
            28 * 1024 ** 2,
            28 * 1024 ** 2,
            28 * 1024 ** 2,
          ]
        ),
      },
    },
    capabilities: {
      loadAverageAvailable: true,
      processMetricsAvailable: true,
      subprocessHistoryLimited: false,
    },
    telemetry: {
      durationMs: 39,
      processRowCount: 4,
      subprocessGroupCount: 3,
      historyTrimmed: false,
      degraded: false,
    },
  };

  return {
    ...context,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    commands: {
      settingsGet: {
        "notifications.enabled": true,
        "notifications.soundEnabled": true,
        "supervisor.evaluationTimeoutSec": 600,
        "monitoring.enabled": monitoringSettings.enabled,
        "monitoring.hostMetricsEnabled": monitoringSettings.hostMetricsEnabled,
        "monitoring.runtimeSummaryEnabled": monitoringSettings.runtimeSummaryEnabled,
        "monitoring.workspaceAttributionEnabled": monitoringSettings.workspaceAttributionEnabled,
        "monitoring.subprocessDrilldownEnabled": monitoringSettings.subprocessDrilldownEnabled,
        "monitoring.sampleIntervalMs": monitoringSettings.sampleIntervalMs,
        "appearance.locale": context.locale,
        "appearance.themeId": context.theme,
        "appearance.personalization.version": 1,
        "appearance.personalization.common.backgroundMode": "image",
        "appearance.personalization.common.backgroundAssetId": "preview-background",
        "appearance.personalization.common.backgroundFit": "cover",
        "appearance.personalization.common.backgroundDimness": 36,
        "appearance.personalization.common.backgroundBlur": 8,
        "appearance.personalization.common.glassEnabled": true,
        "appearance.personalization.common.glassIntensity": 18,
        "appearance.personalization.common.surfaceOpacity": 90,
        "appearance.personalization.desktop.surfaceOpacity": 88,
        "appearance.personalization.mobile.surfaceOpacity": 96,
        "appearance.terminalRenderer": "standard",
        "providers.claude.additionalArgs": ["--verbose"],
        "providers.codex.additionalArgs": ["--sandbox", "workspace-write"],
      },
      settingsUpdate: {},
      settingsPreviewCommandByProviderId: {
        claude: "claude --verbose",
        codex: "codex --sandbox workspace-write",
      },
      monitoringGet: monitoringResponse,
      monitoringRecheck: monitoringResponse,
    },
  };
}

function buildWorkspaceSeed(context: UiPreviewSceneContext, sessions: Session[] = []) {
  return {
    ...context,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    sessions,
    paneLayoutByWorkspaceId: {
      [workspace.id]: { id: "root", type: "leaf" },
    },
    fileTreeByWorkspaceId: {
      [workspace.id]: fileTreeMap,
    },
    openFilesByWorkspaceId: {
      [workspace.id]: openPreviewFiles,
    },
    activeFilePathByWorkspaceId: {
      [workspace.id]: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
    },
    gitStateByWorkspaceId: {
      [workspace.id]: gitStatus,
    },
    gitDiffPreviewByWorkspaceId: {
      [workspace.id]: {
        path: "packages/web/src/app.tsx",
        diff: "diff --git a/packages/web/src/app.tsx b/packages/web/src/app.tsx",
        source: "file",
        staged: false,
      },
    },
    gitBranchListByWorkspaceId: {
      [workspace.id]: {
        current: "feature/ai-agent",
        branches: [
          { name: "main", isCurrent: false, isRemote: false },
          { name: "feature/e2e-ui", isCurrent: false, isRemote: false },
          { name: "feature/ai-agent", isCurrent: true, isRemote: false },
        ],
      },
    },
    worktreeListByWorkspaceId: {
      [workspace.id]: [],
    },
    commands: {
      settingsGet: {
        "appearance.locale": context.locale,
        "appearance.themeId": context.theme,
        "appearance.personalization.version": 1,
        "appearance.personalization.common.backgroundMode": "image",
        "appearance.personalization.common.backgroundAssetId": "preview-background",
        "appearance.personalization.common.backgroundFit": "cover",
        "appearance.personalization.common.backgroundDimness": 36,
        "appearance.personalization.common.backgroundBlur": 8,
        "appearance.personalization.common.glassEnabled": true,
        "appearance.personalization.common.glassIntensity": 18,
        "appearance.personalization.common.surfaceOpacity": 90,
        "appearance.personalization.desktop.surfaceOpacity": 88,
        "appearance.personalization.mobile.surfaceOpacity": 96,
      },
      workspaceList: [workspace],
      providerList: previewProviderList,
      providerRuntimeStatus: previewProviderRuntimeStatus,
      sessionListByWorkspaceId: { [workspace.id]: sessions },
      gitStatusByWorkspaceId: { [workspace.id]: gitStatus },
      gitLogByWorkspaceId: {
        [workspace.id]: {
          entries: [],
        },
      },
      gitBranchesByWorkspaceId: {
        [workspace.id]: {
          current: "feature/ai-agent",
          branches: [
            { name: "main", isCurrent: false, isRemote: false },
            { name: "feature/e2e-ui", isCurrent: false, isRemote: false },
            { name: "feature/ai-agent", isCurrent: true, isRemote: false },
          ],
        },
      },
      fileTreeByWorkspaceId: {
        [workspace.id]: {
          ".": fileTreeMap.get(".") ?? [],
        },
      },
      fileSearchSessionByWorkspaceId: {
        [workspace.id]: searchContentResults,
      },
      worktreeListByWorkspaceId: {
        [workspace.id]: [],
      },
      terminalListByWorkspaceId: {
        [workspace.id]: [],
      },
      skillsLibraryList: previewSkillsLibrary,
      skillsHealthScan: {
        targets: previewSkillTargets,
        mounts: previewSkillMounts,
      },
      skillsRecommendations: {
        entries: [
          {
            slug: "test-automation",
            displayName: "Test Automation",
            description: "Detect and run the most relevant project checks.",
            reason: "This workspace has pnpm scripts for test, build, and lint.",
            sourceQuery: "workspace scripts",
            score: 0.88,
            installed: false,
          },
        ],
        hasMore: false,
      },
      skillsVersionChecks: [
        {
          slug: "frontend-design",
          currentVersion: "1.4.0",
          latestVersion: "1.4.0",
          status: "up_to_date",
        },
      ],
    },
  };
}

function buildWorkspaceCustomSkillsReviewSeed(context: UiPreviewSceneContext) {
  const base = buildWorkspaceSeed(context);

  return {
    ...base,
    commands: {
      ...base.commands,
      skillsLibraryList: [...previewCustomSkillsLibrary, ...previewSkillsLibrary],
      skillsHealthScan: {
        targets: previewSkillTargets,
        mounts: [...previewCustomSkillMounts, ...previewSkillMounts],
      },
      skillsRecommendations: { entries: [], hasMore: false },
      skillsLocalFileEntriesBySlug: previewCustomSkillFiles,
      skillsVersionChecks: [],
    },
  };
}

function buildDraftPaneEditorReviewSeed(context: UiPreviewSceneContext) {
  const reviewWorkspace: Workspace = {
    ...workspace,
    uiState: {
      ...workspace.uiState,
      paneLayout: {
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          {
            id: "left",
            type: "leaf",
            leafKind: "draft",
          },
          {
            id: "right",
            type: "leaf",
            leafKind: "draft",
          },
        ],
      },
    },
  };

  return {
    ...context,
    workspaces: [reviewWorkspace],
    activeWorkspaceId: reviewWorkspace.id,
    sessions: [],
    paneLayoutByWorkspaceId: {
      [reviewWorkspace.id]: {
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          {
            id: "left",
            type: "leaf",
            leafKind: "draft",
          },
          {
            id: "right",
            type: "leaf",
            leafKind: "draft",
          },
        ],
      },
    },
    fileTreeByWorkspaceId: {
      [reviewWorkspace.id]: fileTreeMap,
    },
    openFilesByWorkspaceId: {
      [reviewWorkspace.id]: {},
    },
    gitStateByWorkspaceId: {
      [reviewWorkspace.id]: gitStatus,
    },
    gitBranchListByWorkspaceId: {
      [reviewWorkspace.id]: {
        current: "feature/draft-pane-editor-integration",
        branches: [
          { name: "develop", isCurrent: false, isRemote: false },
          {
            name: "feature/draft-pane-editor-integration",
            isCurrent: true,
            isRemote: false,
          },
        ],
      },
    },
    terminalPanelVisible: false,
    commands: {
      settingsGet: {
        "appearance.locale": context.locale,
        "appearance.themeId": context.theme,
        "appearance.personalization.version": 1,
        "appearance.personalization.common.backgroundMode": "image",
        "appearance.personalization.common.backgroundAssetId": "preview-background",
        "appearance.personalization.common.backgroundFit": "cover",
        "appearance.personalization.common.backgroundDimness": 36,
        "appearance.personalization.common.backgroundBlur": 8,
        "appearance.personalization.common.glassEnabled": true,
        "appearance.personalization.common.glassIntensity": 18,
        "appearance.personalization.common.surfaceOpacity": 90,
        "appearance.personalization.desktop.surfaceOpacity": 88,
      },
      workspaceList: [reviewWorkspace],
      providerList: previewProviderList,
      providerRuntimeStatus: previewProviderRuntimeStatus,
      sessionListByWorkspaceId: { [reviewWorkspace.id]: [] },
      gitStatusByWorkspaceId: { [reviewWorkspace.id]: gitStatus },
      gitLogByWorkspaceId: {
        [reviewWorkspace.id]: {
          entries: [],
        },
      },
      gitBranchesByWorkspaceId: {
        [reviewWorkspace.id]: {
          current: "feature/draft-pane-editor-integration",
          branches: [
            { name: "develop", isCurrent: false, isRemote: false },
            {
              name: "feature/draft-pane-editor-integration",
              isCurrent: true,
              isRemote: false,
            },
          ],
        },
      },
      fileTreeByWorkspaceId: {
        [reviewWorkspace.id]: {
          ".": fileTreeMap.get(".") ?? [],
        },
      },
      fileReadByWorkspaceId: {
        [reviewWorkspace.id]: draftPaneEditorReviewFileContents,
      },
      fileSearchSessionByWorkspaceId: {
        [reviewWorkspace.id]: searchContentResults,
      },
      worktreeListByWorkspaceId: {
        [reviewWorkspace.id]: [],
      },
      terminalListByWorkspaceId: {
        [reviewWorkspace.id]: [],
      },
    },
  };
}

function buildEditorPaneReviewSeed(context: UiPreviewSceneContext) {
  const reviewWorkspace: Workspace = {
    ...workspace,
    uiState: {
      ...workspace.uiState,
      paneLayout: {
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          {
            id: "left",
            type: "leaf",
            leafKind: "editor",
          },
          {
            id: "right",
            type: "leaf",
            leafKind: "draft",
          },
        ],
      },
    },
  };

  return {
    ...context,
    workspaces: [reviewWorkspace],
    activeWorkspaceId: reviewWorkspace.id,
    sessions: [],
    paneLayoutByWorkspaceId: {
      [reviewWorkspace.id]: {
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          {
            id: "left",
            type: "leaf",
            leafKind: "editor",
          },
          {
            id: "right",
            type: "leaf",
            leafKind: "draft",
          },
        ],
      },
    },
    activeEditorPaneIdByWorkspaceId: {
      [reviewWorkspace.id]: "left",
    },
    focusedEditorPaneIdByWorkspaceId: {
      [reviewWorkspace.id]: "left",
    },
    fileTreeByWorkspaceId: {
      [reviewWorkspace.id]: fileTreeMap,
    },
    openFilesByWorkspaceId: {
      [reviewWorkspace.id]: editorPanePreviewFiles,
    },
    activeFilePathByEditorPaneId: {
      [reviewWorkspace.id]: {
        left: "packages/web/src/app.tsx",
      },
    },
    gitStateByWorkspaceId: {
      [reviewWorkspace.id]: gitStatus,
    },
    gitDiffPreviewByWorkspaceId: {
      [reviewWorkspace.id]: {
        path: "packages/web/src/app.tsx",
        diff: [
          "@@ app shell",
          "-  const query = state.query;",
          "+  const searchQuery = workspacePanelState.query;",
          "",
          "-  return <MainLayout />;",
          "+  return <WorkspacePage />;",
        ].join("\n"),
        source: "file",
      },
    },
    gitBranchListByWorkspaceId: {
      [reviewWorkspace.id]: {
        current: "feature/draft-pane-editor-integration",
        branches: [
          { name: "develop", isCurrent: false, isRemote: false },
          {
            name: "feature/draft-pane-editor-integration",
            isCurrent: true,
            isRemote: false,
          },
        ],
      },
    },
    terminalPanelVisible: false,
    commands: {
      settingsGet: {
        "appearance.locale": context.locale,
        "appearance.themeId": context.theme,
        "appearance.personalization.version": 1,
        "appearance.personalization.common.backgroundMode": "image",
        "appearance.personalization.common.backgroundAssetId": "preview-background",
        "appearance.personalization.common.backgroundFit": "cover",
        "appearance.personalization.common.backgroundDimness": 36,
        "appearance.personalization.common.backgroundBlur": 8,
        "appearance.personalization.common.glassEnabled": true,
        "appearance.personalization.common.glassIntensity": 18,
        "appearance.personalization.common.surfaceOpacity": 90,
        "appearance.personalization.desktop.surfaceOpacity": 88,
      },
      workspaceList: [reviewWorkspace],
      providerList: previewProviderList,
      providerRuntimeStatus: previewProviderRuntimeStatus,
      sessionListByWorkspaceId: { [reviewWorkspace.id]: [] },
      gitStatusByWorkspaceId: { [reviewWorkspace.id]: gitStatus },
      gitLogByWorkspaceId: {
        [reviewWorkspace.id]: {
          entries: [],
        },
      },
      gitBranchesByWorkspaceId: {
        [reviewWorkspace.id]: {
          current: "feature/draft-pane-editor-integration",
          branches: [
            { name: "develop", isCurrent: false, isRemote: false },
            {
              name: "feature/draft-pane-editor-integration",
              isCurrent: true,
              isRemote: false,
            },
          ],
        },
      },
      fileTreeByWorkspaceId: {
        [reviewWorkspace.id]: {
          ".": fileTreeMap.get(".") ?? [],
        },
      },
      fileReadByWorkspaceId: {
        [reviewWorkspace.id]: draftPaneEditorReviewFileContents,
      },
      gitDiffByWorkspaceId: {
        [reviewWorkspace.id]: {
          diff: [
            "@@ app shell",
            "-  const query = state.query;",
            "+  const searchQuery = workspacePanelState.query;",
            "",
            "-  return <MainLayout />;",
            "+  return <WorkspacePage />;",
          ].join("\n"),
        },
      },
      fileSearchSessionByWorkspaceId: {
        [reviewWorkspace.id]: searchContentResults,
      },
      worktreeListByWorkspaceId: {
        [reviewWorkspace.id]: [],
      },
      terminalListByWorkspaceId: {
        [reviewWorkspace.id]: [],
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

export function createPageScenes(): UiPreviewSceneDefinition[] {
  return [
    scene("welcome", {
      router: () => ({ initialEntries: ["/"], path: "/" }),
      seed: (context) => ({ ...context }),
      render: () => <WelcomePage />,
    }),
    scene("settings-general", {
      router: () => ({
        initialEntries: ["/more/settings/general"],
        path: "/more/settings/general",
      }),
      seed: (context) => buildSettingsSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("settings-appearance", {
      router: () => ({
        initialEntries: ["/more/settings/appearance"],
        path: "/more/settings/appearance",
      }),
      seed: (context) => buildSettingsSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("settings-providers", {
      router: () => ({
        initialEntries: ["/more/settings/providers"],
        path: "/more/settings/providers",
      }),
      seed: (context) => buildSettingsSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("settings-shortcuts", {
      router: () => ({
        initialEntries: ["/more/settings/shortcuts"],
        path: "/more/settings/shortcuts",
      }),
      seed: (context) => buildSettingsSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("settings-monitoring", {
      router: () => ({
        initialEntries: ["/more/analysis/monitoring"],
        path: "/more/analysis/monitoring",
      }),
      seed: (context) => buildSettingsSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <DeferredMoreFeaturesPage />
        </Suspense>
      ),
    }),
    scene("settings-mobile-root", {
      router: () => ({ initialEntries: ["/more/settings"], path: "/more/settings" }),
      seed: (context) => buildSettingsSeed({ ...context, device: "mobile" }),
      render: () => <SettingsPage />,
    }),
    scene("app-loading-shell", {
      router: () => ({ initialEntries: ["/"], path: "*" }),
      seed: (context) => ({
        ...context,
        authEnabled: null,
        authenticated: false,
        connectionStatus: "connecting",
        workspaces: [],
        activeWorkspaceId: null,
        workspacesLoadState: "idle",
      }),
      render: (context) => (context.device === "mobile" ? <MobileShell /> : <DesktopShell />),
    }),
    scene("workspace-desktop", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <WorkspaceRouteGate>
            <DeferredWorkspaceDesktopView />
          </WorkspaceRouteGate>
        </Suspense>
      ),
    }),
    scene("workspace-custom-skills-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceCustomSkillsReviewSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <WorkspaceRouteGate>
            <DeferredWorkspaceDesktopView />
          </WorkspaceRouteGate>
        </Suspense>
      ),
    }),
    scene("workspace-mobile", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <WorkspaceRouteGate>
            <DeferredWorkspaceMobileView />
          </WorkspaceRouteGate>
        </Suspense>
      ),
    }),
    scene("workspace-draft-pane-editor-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildDraftPaneEditorReviewSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <WorkspaceRouteGate>
            <DeferredWorkspaceDesktopView />
          </WorkspaceRouteGate>
        </Suspense>
      ),
    }),
    scene("workspace-editor-pane-review", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildEditorPaneReviewSeed(context),
      render: () => (
        <Suspense fallback={null}>
          <WorkspaceRouteGate>
            <DeferredWorkspaceDesktopView />
          </WorkspaceRouteGate>
        </Suspense>
      ),
    }),
    scene("auth-preview", {
      router: () => ({ initialEntries: ["/login"], path: "/login" }),
      seed: (context) => ({
        ...context,
        authEnabled: true,
        authenticated: false,
      }),
      render: () => <LoginPage />,
    }),
    scene("session-gate", {
      router: () => ({ initialEntries: ["/session-gate"], path: "/session-gate" }),
      seed: (context) => ({
        ...context,
        authEnabled: false,
        authenticated: false,
      }),
      render: () => <SessionGatePage />,
    }),
    scene("not-found", {
      router: () => ({ initialEntries: ["/preview-missing"], path: "*" }),
      seed: (context) => ({ ...context }),
      render: () => <NotFoundPage />,
    }),
    scene("workspace-load-error", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => ({
        ...context,
        authEnabled: false,
        authenticated: true,
        workspaces: [],
        activeWorkspaceId: null,
        workspacesLoadState: "error",
        workspacesLoadError: "Preview workspace load failure",
      }),
      render: () => (
        <WorkspaceRouteGate>
          <WorkspaceEmptyState />
        </WorkspaceRouteGate>
      ),
    }),
  ];
}
