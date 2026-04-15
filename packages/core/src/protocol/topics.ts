// Topic naming follows spec §3.3: hierarchical, supports glob subscription

export const Topics = {
  // Connection-level
  connectionStatus: 'connection.status',
  connectionReady: 'connection.ready',

  // Workspace-level
  workspaceMeta: (id: string) => `workspace.${id}.meta`,
  workspaceFsDirty: (id: string) => `workspace.${id}.fs.dirty`,
  workspaceGitState: (id: string) => `workspace.${id}.git.state`,
  workspaceAll: (id: string) => `workspace.${id}.*`,

  // Session-level
  sessionState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.state`,
  sessionProgress: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.progress`,
  sessionsAll: (workspaceId: string) => `workspace.${workspaceId}.session.*`,

  // Terminal-level
  terminalOutput: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.output`,
  terminalExit: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.exit`,
  terminalsAll: (workspaceId: string) => `workspace.${workspaceId}.terminal.*`,

  // Notification
  notificationToast: 'notification.toast',

  // Supervisor-level (Phase 3)
  supervisorState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.supervisor.state`,
  supervisorCycle: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.supervisor.cycle`,
} as const;