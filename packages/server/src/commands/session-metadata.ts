import { randomUUID } from "node:crypto";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

function requireSessionMetadataRepo(ctx: { sessionMetadataRepo?: unknown }): asserts ctx is {
  sessionMetadataRepo: NonNullable<typeof ctx.sessionMetadataRepo>;
} {
  if (!ctx.sessionMetadataRepo) {
    throw {
      code: "session_metadata_unavailable",
      message: "Session metadata repository is not configured",
    };
  }
}

registerCommand(
  "session.metadata.get",
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    requireSessionMetadataRepo(ctx);
    const metadata = ctx.sessionMetadataRepo.get(args.sessionId);
    if (!metadata) {
      throw {
        code: "session_metadata_not_found",
        message: `Session metadata not found: ${args.sessionId}`,
      };
    }

    return metadata;
  }
);

registerCommand(
  "session.verification.add",
  z.object({
    sessionId: z.string(),
    command: z.string().trim().min(1),
    status: z.enum(["passed", "failed", "unknown"]),
    exitCode: z.number().int().optional(),
    summary: z.string().optional(),
  }),
  async (args, ctx) => {
    requireSessionMetadataRepo(ctx);
    return ctx.sessionMetadataRepo.addVerificationRun(args.sessionId, {
      id: randomUUID(),
      command: args.command,
      status: args.status,
      exitCode: args.exitCode,
      summary: args.summary?.trim() || undefined,
      createdAt: Date.now(),
    });
  }
);
