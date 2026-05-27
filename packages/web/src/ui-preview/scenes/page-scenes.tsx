import {
  deriveMonitoringMode,
  type FileNode,
  type GitStatus,
  type MonitoringResponse,
  type Session,
  type Workspace,
} from "@coder-studio/core";
import { LoginPage } from "../../features/auth";
import { SessionGatePage } from "../../features/auth/session-gate";
import { NotFoundPage } from "../../features/not-found";
import { SettingsPage } from "../../features/settings";
import { WelcomePage } from "../../features/welcome";
import { WorkspaceDesktopView } from "../../features/workspace/views/desktop/workspace-desktop-view";
import { WorkspaceMobileView } from "../../features/workspace/views/mobile/workspace-mobile-view";
import { WorkspaceEmptyState } from "../../features/workspace/views/shared/workspace-empty-state";
import { WorkspaceRouteGate } from "../../features/workspace/views/shared/workspace-route-gate";
import { DesktopShell } from "../../shells/desktop-shell";
import { MobileShell } from "../../shells/mobile-shell";
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
    paneLayout: { id: "root", type: "leaf" },
  },
};

const gitStatus: GitStatus = {
  branch: "main",
  ahead: 0,
  behind: 0,
  staged: [],
  modified: [{ path: "packages/web/src/app.tsx", status: "modified" }],
  untracked: [{ path: "e2e-ui/scenes/index.ts", status: "untracked" }],
  deleted: [],
};

const fileTreeMap = new Map<string, FileNode[]>();
fileTreeMap.set(".", [
  { name: "packages", path: "packages", kind: "dir" },
  { name: "e2e-ui", path: "e2e-ui", kind: "dir" },
  { name: "README.md", path: "README.md", kind: "file" },
]);

function buildSettingsSeed(context: UiPreviewSceneContext) {
  const monitoringSettings = {
    enabled: true,
    hostMetricsEnabled: true,
    runtimeSummaryEnabled: true,
    workspaceAttributionEnabled: true,
    subprocessDrilldownEnabled: false,
    sampleIntervalMs: 10000 as const,
  };
  const monitoringResponse: MonitoringResponse = {
    settings: monitoringSettings,
    snapshot: {
      sampledAt: Date.UTC(2026, 4, 27, 14, 27, 49),
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
        serverCpuPercent: null,
        serverMemoryBytes: null,
        totalManagedCpuPercent: 0,
        totalManagedMemoryBytes: 0,
        managedProcessCount: 4,
        cpuShareOfHostPercent: 0,
        memoryShareOfHostPercent: 0,
      },
      workspaces: [],
      sessions: [],
      subprocessGroups: [],
      backgroundGroups: [],
    },
    history: {
      host: {
        points: Array.from({ length: 30 }, (_, index) => ({
          sampledAt: Date.UTC(2026, 4, 27, 14, 27, 49) - (29 - index) * 30_000,
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
          sampledAt: Date.UTC(2026, 4, 27, 14, 27, 49) - (29 - index) * 30_000,
          cpuPercent: index % 8 === 0 ? 0.2 : 0,
          memoryBytes: 0,
          processCount: 4,
        })),
      },
      workspaces: {},
      sessions: {},
      subprocessGroups: {},
    },
    capabilities: {
      loadAverageAvailable: true,
      processMetricsAvailable: true,
      subprocessHistoryLimited: false,
    },
    telemetry: {
      durationMs: 39,
      processRowCount: 4,
      subprocessGroupCount: 0,
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
    gitStateByWorkspaceId: {
      [workspace.id]: gitStatus,
    },
    gitBranchListByWorkspaceId: {
      [workspace.id]: {
        current: "main",
        branches: [
          { name: "main", isCurrent: true, isRemote: false },
          { name: "feature/e2e-ui", isCurrent: false, isRemote: false },
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
      sessionListByWorkspaceId: { [workspace.id]: sessions },
      gitStatusByWorkspaceId: { [workspace.id]: gitStatus },
      gitBranchesByWorkspaceId: {
        [workspace.id]: {
          current: "main",
          branches: [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "feature/e2e-ui", isCurrent: false, isRemote: false },
          ],
        },
      },
      fileTreeByWorkspaceId: {
        [workspace.id]: {
          ".": fileTreeMap.get(".") ?? [],
        },
      },
      worktreeListByWorkspaceId: {
        [workspace.id]: [],
      },
      terminalListByWorkspaceId: {
        [workspace.id]: [],
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
      router: () => ({ initialEntries: ["/settings"], path: "/settings" }),
      seed: (context) => buildSettingsSeed(context),
      render: () => <SettingsPage />,
    }),
    scene("settings-appearance", {
      router: () => ({ initialEntries: ["/settings"], path: "/settings" }),
      seed: (context) => buildSettingsSeed(context),
      render: () => <SettingsPage />,
    }),
    scene("settings-providers", {
      router: () => ({ initialEntries: ["/settings"], path: "/settings" }),
      seed: (context) => buildSettingsSeed(context),
      render: () => <SettingsPage />,
    }),
    scene("settings-shortcuts", {
      router: () => ({ initialEntries: ["/settings"], path: "/settings" }),
      seed: (context) => buildSettingsSeed(context),
      render: () => <SettingsPage />,
    }),
    scene("settings-mobile-root", {
      router: () => ({ initialEntries: ["/settings"], path: "/settings" }),
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
        <WorkspaceRouteGate>
          <WorkspaceDesktopView />
        </WorkspaceRouteGate>
      ),
    }),
    scene("workspace-mobile", {
      router: () => ({ initialEntries: ["/workspace"], path: "/workspace" }),
      seed: (context) => buildWorkspaceSeed(context),
      render: () => (
        <WorkspaceRouteGate>
          <WorkspaceMobileView />
        </WorkspaceRouteGate>
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
