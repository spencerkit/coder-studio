import { randomUUID } from "node:crypto";
import {
  SESSION_ACTIVITY_KINDS,
  SESSION_ACTIVITY_PHASES,
  SESSION_ACTIVITY_STATUSES,
} from "@coder-studio/core";
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

registerCommand(
  "session.activity.record",
  z.object({
    sessionId: z.string(),
    kind: z.enum(SESSION_ACTIVITY_KINDS),
    phase: z.enum(SESSION_ACTIVITY_PHASES).optional(),
    title: z.string().trim().min(1),
    summary: z.string().trim().optional(),
    status: z.enum(SESSION_ACTIVITY_STATUSES).optional(),
    command: z.string().trim().optional(),
    files: z.array(z.string()).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
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

    const next = ctx.sessionMetadataRepo.addActivityEntry(args.sessionId, {
      id: randomUUID(),
      sessionId: args.sessionId,
      workspaceId: metadata.workspaceId,
      kind: args.kind,
      phase: args.phase,
      title: args.title,
      summary: args.summary?.trim() || undefined,
      status: args.status,
      command: args.command?.trim() || undefined,
      files: args.files,
      payload: args.payload,
      createdAt: Date.now(),
    });

    ctx.broadcaster?.broadcast?.(`workspace.${next.workspaceId}.session-activity.changed`, {
      sessionId: args.sessionId,
    });

    return next;
  }
);

registerCommand(
  "session.activity.list",
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

    return {
      sessionId: args.sessionId,
      entries: metadata.activityEntries,
    };
  }
);
