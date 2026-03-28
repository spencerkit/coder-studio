export type WorkspaceSyncVersionTracker = {
  advance: (workspaceId: string) => number;
  read: (workspaceId: string) => number;
  isCurrent: (workspaceId: string, version: number) => boolean;
};

export const createWorkspaceSyncVersionTracker = (): WorkspaceSyncVersionTracker => {
  const versions = new Map<string, number>();

  const read = (workspaceId: string) => versions.get(workspaceId) ?? 0;

  return {
    advance: (workspaceId: string) => {
      const nextVersion = read(workspaceId) + 1;
      versions.set(workspaceId, nextVersion);
      return nextVersion;
    },
    read,
    isCurrent: (workspaceId: string, version: number) => read(workspaceId) === version,
  };
};

const workspaceSyncVersionTracker = createWorkspaceSyncVersionTracker();

export const advanceWorkspaceSyncVersion = (workspaceId: string) => (
  workspaceSyncVersionTracker.advance(workspaceId)
);

export const readWorkspaceSyncVersion = (workspaceId: string) => (
  workspaceSyncVersionTracker.read(workspaceId)
);

export const isWorkspaceSyncVersionCurrent = (workspaceId: string, version: number) => (
  workspaceSyncVersionTracker.isCurrent(workspaceId, version)
);
