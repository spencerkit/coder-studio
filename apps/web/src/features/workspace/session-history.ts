import type {
  BackendSessionHistoryRecord,
  SessionHistoryExpansionState,
  SessionHistoryGroup,
  SessionHistoryRecord,
} from "../../types/app";

export const mapSessionHistoryRecord = (
  record: BackendSessionHistoryRecord,
): SessionHistoryRecord => ({
  workspaceId: record.workspace_id,
  workspaceTitle: record.workspace_title,
  workspacePath: record.workspace_path,
  sessionId: record.session_id,
  title: record.title,
  provider: record.provider,
  mounted: record.mounted,
  state: record.state,
  createdAt: record.created_at,
  lastActiveAt: record.last_active_at,
  resumeId: record.resume_id,
});

export const groupSessionHistory = (
  records: SessionHistoryRecord[],
  currentWorkspaceId?: string | null,
): SessionHistoryGroup[] => {
  const groups = new Map<string, SessionHistoryGroup>();

  for (const record of records) {
    const group = groups.get(record.workspaceId) ?? {
      workspaceId: record.workspaceId,
      workspaceTitle: record.workspaceTitle,
      workspacePath: record.workspacePath,
      records: [],
    };
    group.records.push(record);
    groups.set(record.workspaceId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      records: [...group.records].sort((left, right) => right.lastActiveAt - left.lastActiveAt),
    }))
    .filter((group) => group.records.length > 0)
    .sort((left, right) => {
      if (currentWorkspaceId && left.workspaceId === currentWorkspaceId) return -1;
      if (currentWorkspaceId && right.workspaceId === currentWorkspaceId) return 1;
      const leftTime = left.records[0]?.lastActiveAt ?? 0;
      const rightTime = right.records[0]?.lastActiveAt ?? 0;
      return rightTime - leftTime;
    });
};

export const createInitialHistoryExpansion = (
  groups: SessionHistoryGroup[],
  currentWorkspaceId?: string | null,
): SessionHistoryExpansionState => Object.fromEntries(
  groups.map((group) => [group.workspaceId, group.workspaceId === currentWorkspaceId]),
);

export const selectHistoryPrimaryAction = (
  record: Pick<SessionHistoryRecord, "state">,
) => {
  if (record.state === "live") return "focus" as const;
  if (record.state === "detached") return "restore" as const;
  return null;
};

export const selectHistoryPrimaryActionBadge = (
  record: Pick<SessionHistoryRecord, "state">,
) => {
  const action = selectHistoryPrimaryAction(record);
  if (action === "restore") return "restore" as const;
  return null;
};
