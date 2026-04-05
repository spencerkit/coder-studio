import type { SessionHistoryRecord } from "../../types/app";

const providerHistoryIdentity = (record: Pick<SessionHistoryRecord, "provider" | "resumeId">) => (
  `${record.provider}:${record.resumeId}`
);

export const listRestoreCandidatesForWorkspace = ({
  workspaceId,
  mountedProviders,
  records,
}: {
  workspaceId: string;
  mountedProviders: Set<string>;
  records: SessionHistoryRecord[];
}) =>
  records.filter((record) => (
    record.workspaceId === workspaceId
    && !mountedProviders.has(providerHistoryIdentity(record))
  ));
