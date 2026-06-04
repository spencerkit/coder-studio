// Topic naming follows spec §3.3: hierarchical, supports glob subscription

export const Topics = {
  // Connection-level
  connectionStatus: "connection.status",
  connectionReady: "connection.ready",

  // Workspace-level
  workspaceMeta: (id: string) => `workspace.${id}.meta`,
  workspaceFsDirty: (id: string) => `workspace.${id}.fs.dirty`,
  workspaceGitState: (id: string) => `workspace.${id}.git.state`,
  workspaceLspDiagnostics: (workspaceId: string) => `workspace.${workspaceId}.lsp.diagnostics`,
  workspaceAll: (id: string) => `workspace.${id}.*`,

  // Session-level
  sessionState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.state`,
  sessionLifecycle: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.lifecycle`,
  sessionProgress: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.progress`,
  sessionsAll: (workspaceId: string) => `workspace.${workspaceId}.session.*`,

  // Terminal-level
  terminalCreated: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.created`,
  terminalOutput: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.output`,
  terminalContinuityLost: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.continuity_lost`,
  terminalExit: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.exit`,
  terminalsAll: (workspaceId: string) => `workspace.${workspaceId}.terminal.*`,

  // Task-level
  workspaceTaskDiscovered: (workspaceId: string) => `workspace.${workspaceId}.task.discovered`,
  workspaceTaskRun: (workspaceId: string, runId: string) =>
    `workspace.${workspaceId}.task.${runId}`,
  workspaceTasksAll: (workspaceId: string) => `workspace.${workspaceId}.task.*`,

  // Notification
  notificationToast: "notification.toast",
  monitoringSnapshotUpdated: "monitoring.snapshot.updated",
  updateStateChanged: "update.state.changed",
  systemDependencyInstallOutput: (jobId: string) => `systemDeps.install.${jobId}.output`,

  // Supervisor-level (Phase 3)
  supervisorState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.supervisor.state`,
} as const;
