/**
 * Terminal Commands
 */

import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  type CustomTerminalProfile,
  encodeTerminalBinaryFrame,
  TERMINAL_BINARY_PROTOCOL_VERSION,
  TERMINAL_INPUT_ACTIVITIES,
  TerminalBinaryFrameType,
  type TerminalInputActivity,
  TerminalInputBase64Args,
  TerminalInputBinaryArgs,
  TerminalSnapshotBinaryResult,
} from "@coder-studio/core";
import { z } from "zod";
import { resolveSafe } from "../fs/file-io.js";
import { registerHostCommand } from "../host/command-registry.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";
import { listTerminalProfiles, resolveTerminalLaunch } from "../terminal-profiles/registry.js";
import { executeRuntimeCommandOnTarget } from "../ws/dispatch.js";

const TerminalInputActivitySchema = z.enum(TERMINAL_INPUT_ACTIVITIES).optional();
const TerminalThemeBackgroundSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/)
  .optional();
const TrimmedNonEmptyStringSchema = z.string().trim().min(1);
const CustomTerminalProfileIdSchema = z.custom<CustomTerminalProfile["id"]>(
  (value) => typeof value === "string" && value.startsWith("custom:"),
  {
    message: "Custom terminal profile ids must start with custom:",
  }
);
const CustomTerminalProfileSchema: z.ZodType<CustomTerminalProfile> = z.object({
  id: CustomTerminalProfileIdSchema,
  label: TrimmedNonEmptyStringSchema,
  command: TrimmedNonEmptyStringSchema,
  args: z.array(z.string()).optional(),
  icon: z.string().optional(),
});
const CustomTerminalProfilesSchema: z.ZodType<CustomTerminalProfile[]> = z
  .array(CustomTerminalProfileSchema)
  .superRefine((profiles, issueCtx) => {
    const seen = new Set<string>();

    for (const [index, profile] of profiles.entries()) {
      if (!seen.has(profile.id)) {
        seen.add(profile.id);
        continue;
      }

      issueCtx.addIssue({
        code: "custom",
        message: `Duplicate terminal profile id: ${profile.id}`,
        path: [index, "id"],
      });
    }
  });

const TerminalInputSchema = z.union([
  z.object({
    terminalId: z.string(),
    bytes: z.string(),
    activity: TerminalInputActivitySchema,
    submittedText: z.string().optional(),
  }),
  z.object({
    terminalId: z.string(),
    transport: z.literal("binary"),
    streamId: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    activity: TerminalInputActivitySchema,
    submittedText: z.string().optional(),
  }),
]);

const DEFAULT_TERMINAL_READ_BYTES = 4096;
const MAX_TERMINAL_READ_BYTES = 65_536;

const pendingTerminalInput = new Map<number, { args: TerminalInputBinaryArgs; payload: Buffer }>();
let nextOutboundBinaryStreamId = 0;

function decodeTerminalInput(args: TerminalInputBase64Args | TerminalInputBinaryArgs): Buffer {
  if ("bytes" in args) {
    return Buffer.from(args.bytes, "base64");
  }

  const pending = pendingTerminalInput.get(args.streamId);
  if (!pending) {
    throw {
      code: "terminal_input_binary_missing",
      message: "Missing binary terminal input payload",
    };
  }
  pendingTerminalInput.delete(args.streamId);
  return pending.payload;
}

function normalizeTerminalInputActivity(
  activity: TerminalInputActivity | undefined
): TerminalInputActivity | undefined {
  return activity;
}

export function registerPendingTerminalInput(args: TerminalInputBinaryArgs, payload: Buffer): void {
  pendingTerminalInput.set(args.streamId, { args, payload });
}

export function clearPendingTerminalInput(streamId: number): void {
  pendingTerminalInput.delete(streamId);
}

function allocateOutboundBinaryStreamId(): number {
  nextOutboundBinaryStreamId = (nextOutboundBinaryStreamId + 1) >>> 0;
  return nextOutboundBinaryStreamId;
}

function sendTerminalBinaryFrame(
  clientId: string | undefined,
  ctx: Pick<RuntimeCommandContext, "hostBridge">,
  frame: {
    type: (typeof TerminalBinaryFrameType)[keyof typeof TerminalBinaryFrameType];
    meta: number;
    streamId: number;
    payload: Buffer;
  }
): void {
  if (!clientId) {
    return;
  }

  ctx.hostBridge.sendBinaryToClient(
    clientId,
    Buffer.from(
      encodeTerminalBinaryFrame(
        {
          version: TERMINAL_BINARY_PROTOCOL_VERSION,
          type: frame.type,
          flags: 0,
          meta: frame.meta,
          streamId: frame.streamId,
          payloadSize: frame.payload.length,
        },
        frame.payload
      )
    )
  );
}

function getTerminalSettings(settingsRepo: { get: <T = unknown>(key: string) => T | undefined }): {
  configuredDefaultProfileId?: string;
  customProfiles: CustomTerminalProfile[];
} {
  const configuredDefaultProfileId = settingsRepo.get<string>("terminal.defaultProfileId");
  const customProfiles = CustomTerminalProfilesSchema.catch([]).parse(
    settingsRepo.get("terminal.profiles")
  );

  return {
    configuredDefaultProfileId,
    customProfiles,
  };
}

async function resolveWorkspaceCwd(workspacePath: string, cwdPath?: string): Promise<string> {
  if (!cwdPath || cwdPath === ".") {
    return workspacePath;
  }

  if (isAbsolute(cwdPath)) {
    throw { code: "invalid_cwd_path", message: "cwdPath must be workspace-relative" };
  }

  let resolvedCwd: string;
  try {
    resolvedCwd = resolveSafe(workspacePath, cwdPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "path_escape"
    ) {
      throw { code: "invalid_cwd_path", message: "cwdPath must be workspace-relative" };
    }
    throw error;
  }

  const cwdStats = await stat(resolvedCwd).catch(() => null);
  if (!cwdStats) {
    throw { code: "cwd_not_found", message: `Directory not found: ${cwdPath}` };
  }
  if (!cwdStats.isDirectory()) {
    throw { code: "cwd_not_directory", message: `Not a directory: ${cwdPath}` };
  }

  return resolvedCwd;
}

// terminal.list
registerRuntimeCommand(
  "terminal.list",
  z.object({
    workspaceId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      return ctx.terminalMgr
        .getAll()
        .map((terminal) => terminal.toDTO())
        .filter((terminal) => terminal.workspaceId === args.workspaceId);
    },
  }
);

// terminal.read
registerRuntimeCommand(
  "terminal.read",
  z.object({
    terminalId: z.string(),
    bytes: z.number().int().positive().max(MAX_TERMINAL_READ_BYTES).optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
    handler: async (args, ctx) => {
      const bytes = args.bytes ?? DEFAULT_TERMINAL_READ_BYTES;
      const tail = ctx.terminalMgr.getRingBufferTail(args.terminalId, bytes);

      return {
        terminalId: args.terminalId,
        bytes,
        text: tail.toString("utf8"),
      };
    },
  }
);

registerHostCommand("terminal.profiles.list", z.object({}).default({}), async (_args, ctx) => {
  const terminalSettings = getTerminalSettings(ctx.settingsRepo);
  return listTerminalProfiles({
    configuredDefaultProfileId: terminalSettings.configuredDefaultProfileId,
    customProfiles: terminalSettings.customProfiles,
  });
});

// terminal.create
registerHostCommand(
  "terminal.create",
  z.object({
    workspaceId: z.string(),
    profileId: z.string().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    cwdPath: z.string().optional(),
    themeBackground: TerminalThemeBackgroundSchema,
  }),
  async (args, ctx, meta) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const cwd = await resolveWorkspaceCwd(workspace.path, args.cwdPath);
    const terminalSettings = getTerminalSettings(ctx.settingsRepo);
    const launch = await resolveTerminalLaunch({
      configuredDefaultProfileId: terminalSettings.configuredDefaultProfileId,
      customProfiles: terminalSettings.customProfiles,
      requestedProfileId: args.profileId,
      workspacePath: cwd,
    });

    return executeRuntimeCommandOnTarget(
      "terminal.spawn",
      {
        workspaceId: args.workspaceId,
        argv: launch.argv,
        title: launch.title,
        cwd: launch.cwd,
        cols: args.cols ?? 120,
        rows: args.rows ?? 30,
        themeBackground: args.themeBackground,
      },
      ctx,
      meta,
      { kind: "workspace", workspaceId: args.workspaceId }
    );
  }
);

// terminal.spawn
registerRuntimeCommand(
  "terminal.spawn",
  z.object({
    workspaceId: z.string(),
    argv: z.array(z.string()).min(1),
    title: z.string().min(1),
    cwd: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    themeBackground: TerminalThemeBackgroundSchema,
  }),
  {
    visibility: "internal",
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      return ctx.terminalMgr.create({
        workspaceId: args.workspaceId,
        kind: "shell",
        argv: args.argv,
        title: args.title,
        cwd: args.cwd,
        cols: args.cols,
        rows: args.rows,
        themeBackground: args.themeBackground,
      });
    },
  }
);

// terminal.replay
registerRuntimeCommand(
  "terminal.replay",
  z.object({
    terminalId: z.string(),
    lastSeq: z.number().int().nonnegative().optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
    handler: async (args, ctx, meta) => {
      const replay = ctx.terminalMgr.replay(args.terminalId, args.lastSeq ?? 0);
      if (replay.status !== "ok") {
        return replay;
      }

      const streamId = allocateOutboundBinaryStreamId();
      sendTerminalBinaryFrame(meta?.clientId, ctx, {
        type: TerminalBinaryFrameType.Replay,
        meta: replay.seq,
        streamId,
        payload: replay.data,
      });

      return {
        status: "ok" as const,
        transport: "binary" as const,
        streamId,
        size: replay.data.length,
        seq: replay.seq,
      };
    },
  }
);

// terminal.snapshot
registerRuntimeCommand(
  "terminal.snapshot",
  z.object({
    terminalId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
    handler: async (args, ctx, meta) => {
      const snapshot = await ctx.terminalMgr.snapshot(args.terminalId);
      if (snapshot.status !== "ok") {
        return snapshot;
      }

      const streamId = allocateOutboundBinaryStreamId();
      sendTerminalBinaryFrame(meta?.clientId, ctx, {
        type: TerminalBinaryFrameType.Snapshot,
        meta: snapshot.seq,
        streamId,
        payload: snapshot.data,
      });

      return {
        status: "ok" as const,
        transport: "binary" as const,
        streamId,
        size: snapshot.data.length,
        seq: snapshot.seq,
        rows: snapshot.rows,
        cols: snapshot.cols,
        source: "headless" as const,
      } satisfies TerminalSnapshotBinaryResult;
    },
  }
);

// terminal.close
registerRuntimeCommand(
  "terminal.close",
  z.object({
    terminalId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
    handler: async (args, ctx) => {
      await ctx.terminalMgr.close(args.terminalId);
    },
  }
);

// terminal.input
registerRuntimeCommand("terminal.input", TerminalInputSchema, {
  resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
  handler: async (args, ctx) => {
    const buffer = decodeTerminalInput(args);
    const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
    if (sessionId) {
      ctx.sessionMgr.sendInput(
        sessionId,
        buffer,
        normalizeTerminalInputActivity(args.activity),
        args.submittedText
      );
      return;
    }

    ctx.terminalMgr.write(args.terminalId, buffer);
  },
});

// terminal.resize
registerRuntimeCommand(
  "terminal.resize",
  z.object({
    terminalId: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  {
    resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
    handler: async (args, ctx) => {
      const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
      if (sessionId) {
        ctx.sessionMgr.resize(sessionId, args.cols, args.rows);
        return;
      }

      ctx.terminalMgr.resize(args.terminalId, args.cols, args.rows);
    },
  }
);

// terminal.syncThemeBackground
registerRuntimeCommand(
  "terminal.syncThemeBackground",
  z.object({
    workspaceId: z.string(),
    themeBackground: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      ctx.terminalMgr.syncThemeBackgroundForWorkspace(args.workspaceId, args.themeBackground);
    },
  }
);
