import type { SessionHistoryRecord } from "../../types/app.ts";

export const listRestoreCandidatesForWorkspace = ({
  workspaceId,
  mountedSessionIds,
  records,
}: {
  workspaceId: string;
  mountedSessionIds: Set<string>;
  records: SessionHistoryRecord[];
}) =>
  records.filter((record) => (
    record.workspaceId === workspaceId
    && record.recoverable
    && !mountedSessionIds.has(record.sessionId)
  ));
