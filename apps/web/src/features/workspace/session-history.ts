import type {
  BackendSessionHistoryRecord,
  SessionHistoryGroup,
  SessionHistoryRecord,
} from "../../types/app.ts";

export const mapSessionHistoryRecord = (
  record: BackendSessionHistoryRecord,
): SessionHistoryRecord => ({
  workspaceId: record.workspace_id,
  workspaceTitle: record.workspace_title,
  workspacePath: record.workspace_path,
  sessionId: String(record.session_id),
  title: record.title,
  status: record.status,
  archived: record.archived,
  mounted: record.mounted,
  recoverable: record.recoverable,
  lastActiveAt: record.last_active_at,
  archivedAt: record.archived_at ?? null,
  claudeSessionId: record.claude_session_id ?? null,
});

export const groupSessionHistory = (
  records: SessionHistoryRecord[],
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
      const leftTime = left.records[0]?.lastActiveAt ?? 0;
      const rightTime = right.records[0]?.lastActiveAt ?? 0;
      return rightTime - leftTime;
    });
};

export const selectHistoryPrimaryAction = (
  record: Pick<SessionHistoryRecord, "archived" | "mounted" | "recoverable">,
) => {
  if (record.mounted && !record.archived) {
    return "focus" as const;
  }
  if (record.recoverable) {
    return "restore" as const;
  }
  return "noop" as const;
};
