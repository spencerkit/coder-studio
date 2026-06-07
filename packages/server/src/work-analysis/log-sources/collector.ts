import { createHash } from "node:crypto";

import type {
  ProviderWorkLogSource,
  WorkLogCollection,
  WorkLogCollector,
  WorkLogSourceRef,
} from "./types.js";

function buildSourceDigest(input: {
  sourceRefs: WorkLogSourceRef[];
  sessionIds: string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceRefs: [...input.sourceRefs].sort((left, right) =>
          `${left.providerId}:${left.path}`.localeCompare(`${right.providerId}:${right.path}`)
        ),
        sessionIds: [...input.sessionIds].sort(),
      })
    )
    .digest("hex");
}

export function createWorkLogCollector(deps: {
  sources: ProviderWorkLogSource[];
}): WorkLogCollector {
  return {
    async collect(
      input: Parameters<ProviderWorkLogSource["discover"]>[0]
    ): Promise<WorkLogCollection> {
      const providers = await Promise.all(deps.sources.map((source) => source.discover(input)));
      const sessions = providers
        .flatMap((provider) => provider.sessions)
        .sort((left, right) => {
          return (
            left.lastActiveAt - right.lastActiveAt ||
            left.providerId.localeCompare(right.providerId) ||
            left.sessionId.localeCompare(right.sessionId)
          );
        });

      return {
        sessions,
        providers,
        sourceDigest: buildSourceDigest({
          sourceRefs: providers.flatMap((provider) => provider.sourceRefs),
          sessionIds: sessions.map((session) => `${session.providerId}:${session.sessionId}`),
        }),
      };
    },
  };
}
