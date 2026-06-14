import { WORKSPACE_MEMORY_SOURCE_KINDS, WORKSPACE_MEMORY_TYPES } from "@coder-studio/core";
import { z } from "zod";
import { type CommandContext, registerCommand } from "../ws/dispatch.js";

const memoryTypeSchema = z.enum(WORKSPACE_MEMORY_TYPES);
const memorySourceKindSchema = z.enum(WORKSPACE_MEMORY_SOURCE_KINDS);

const workspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

const legacyTagArgGuard = z.unknown().superRefine((input, ctx) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return;
  }

  const keys = ["tag", "tags"].filter((key) => Object.hasOwn(input, key));
  if (keys.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Legacy memory tag arguments are not supported: ${keys.join(", ")}`,
    });
  }
});

function rejectLegacyTagArgs<T extends z.ZodTypeAny>(schema: T) {
  return legacyTagArgGuard.pipe(schema);
}

const memoryListBaseSchema = workspaceSchema.extend({
  query: z.string().optional(),
  type: memoryTypeSchema.optional(),
  includeArchived: z.boolean().optional(),
});
const memoryListSchema = rejectLegacyTagArgs(memoryListBaseSchema);
const memorySearchSchema = rejectLegacyTagArgs(memoryListBaseSchema.required({ query: true }));

const memoryIdSchema = workspaceSchema.extend({
  id: z.string().min(1),
});

const sourceHintSchema = z
  .object({
    kind: memorySourceKindSchema.optional(),
    providerId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    skillSlug: z.string().trim().min(1).optional(),
  })
  .strict();

const memoryCreateSchema = rejectLegacyTagArgs(
  workspaceSchema.extend({
    type: memoryTypeSchema,
    content: z.string().trim().min(1).max(20_000),
    sourceHint: sourceHintSchema.optional(),
  })
);

const memoryUpdateSchema = rejectLegacyTagArgs(
  memoryIdSchema.extend({
    type: memoryTypeSchema.optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
  })
);

type MemorySourceHint = z.output<typeof sourceHintSchema>;
type MemoryChangeAction = "created" | "updated" | "deleted";

function getWorkspaceOrThrow(ctx: CommandContext, workspaceId: string) {
  const workspace = ctx.workspaceMgr.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }
  return workspace;
}

function getMemoryRepoOrThrow(ctx: CommandContext) {
  if (!ctx.memoryRepo) {
    throw {
      code: "memory_storage_unavailable",
      message: "Workspace memory storage is not available",
    };
  }
  return ctx.memoryRepo;
}

function notFound(id: string): never {
  throw { code: "memory_not_found", message: `Memory entry not found: ${id}` };
}

function defaultSourceKind(sourceHint: MemorySourceHint | undefined) {
  if (sourceHint?.kind) {
    return sourceHint.kind;
  }

  if (sourceHint?.skillSlug) {
    return "skill";
  }

  if (sourceHint?.providerId || sourceHint?.sessionId) {
    return "agent";
  }

  return "user";
}

function broadcastMemoryChanged(
  ctx: CommandContext,
  workspaceId: string,
  entryId: string,
  action: MemoryChangeAction
): void {
  ctx.broadcaster.broadcast?.(`workspace.${workspaceId}.memory.changed`, {
    workspaceId,
    entryId,
    action,
  });
}

registerCommand("memory.list", memoryListSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const memoryRepo = getMemoryRepoOrThrow(ctx);
  return memoryRepo.list(args);
});

registerCommand("memory.search", memorySearchSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const memoryRepo = getMemoryRepoOrThrow(ctx);
  return memoryRepo.list(args);
});

registerCommand("memory.get", memoryIdSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const memoryRepo = getMemoryRepoOrThrow(ctx);
  return memoryRepo.get(args.workspaceId, args.id) ?? notFound(args.id);
});

registerCommand("memory.create", memoryCreateSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const memoryRepo = getMemoryRepoOrThrow(ctx);
  const entry = memoryRepo.create({
    workspaceId: args.workspaceId,
    type: args.type,
    content: args.content,
    source: {
      defaultKind: defaultSourceKind(args.sourceHint),
      ...args.sourceHint,
    },
  });

  broadcastMemoryChanged(ctx, args.workspaceId, entry.id, "created");
  return entry;
});

registerCommand("memory.update", memoryUpdateSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const memoryRepo = getMemoryRepoOrThrow(ctx);
  const entry = memoryRepo.update({
    workspaceId: args.workspaceId,
    id: args.id,
    type: args.type,
    content: args.content,
  });

  broadcastMemoryChanged(ctx, args.workspaceId, entry.id, "updated");
  return entry;
});

registerCommand("memory.delete", memoryIdSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const memoryRepo = getMemoryRepoOrThrow(ctx);
  const entry = memoryRepo.delete(args.workspaceId, args.id);

  broadcastMemoryChanged(ctx, args.workspaceId, entry.id, "deleted");
  return entry;
});
