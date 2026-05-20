import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const supervisorObjectiveSchema = z.string().trim().min(1).max(4000);
const createSupervisorSchema = z
  .object({
    sessionId: z.string(),
    workspaceId: z.string(),
    objective: supervisorObjectiveSchema,
    evaluatorProviderId: z.string(),
    evaluatorModel: z.string().trim().min(1).max(200).optional(),
    maxSupervisionCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    scheduledAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
const updateSupervisorSchema = z
  .object({
    id: z.string(),
    objective: supervisorObjectiveSchema.optional(),
    evaluatorProviderId: z.string().optional(),
    evaluatorModel: z.string().trim().min(1).max(200).nullable().optional(),
    maxSupervisionCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    scheduledAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.objective !== undefined ||
      input.evaluatorProviderId !== undefined ||
      input.evaluatorModel !== undefined ||
      input.maxSupervisionCount !== undefined ||
      input.scheduledAt !== undefined,
    "at least one supervisor field is required"
  );
const sessionIdSchema = z.object({ sessionId: z.string() });
const workspaceIdSchema = z.object({ workspaceId: z.string() });
const supervisorIdSchema = z.object({ id: z.string() });
const restoreSupervisorSchema = z
  .object({
    sessionId: z.string(),
    workspaceId: z.string(),
    sourceTargetId: z.string(),
    evaluatorProviderId: z.string(),
    evaluatorModel: z.string().trim().min(1).max(200).optional(),
    maxSupervisionCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    scheduledAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

// supervisor.create
registerCommand("supervisor.create", createSupervisorSchema, async (args, ctx) => {
  return {
    supervisor: await ctx.supervisorMgr.create({
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      objective: args.objective,
      evaluatorProviderId: args.evaluatorProviderId,
      evaluatorModel: args.evaluatorModel,
      maxSupervisionCount: args.maxSupervisionCount,
      scheduledAt: args.scheduledAt,
    }),
  };
});

// supervisor.get
registerCommand("supervisor.get", sessionIdSchema, async (args, ctx) => {
  return { supervisor: ctx.supervisorMgr.getBySession(args.sessionId) ?? null };
});

registerCommand("supervisor.listRecoverableTargets", workspaceIdSchema, async (args, ctx) => {
  return { targets: await ctx.supervisorMgr.listRecoverableTargets(args.workspaceId) };
});

// supervisor.update
registerCommand("supervisor.update", updateSupervisorSchema, async (args, ctx) => {
  return {
    supervisor: await ctx.supervisorMgr.update(args.id, {
      objective: args.objective,
      evaluatorProviderId: args.evaluatorProviderId,
      evaluatorModel: args.evaluatorModel,
      maxSupervisionCount: args.maxSupervisionCount,
      scheduledAt: args.scheduledAt,
    }),
  };
});

// supervisor.delete
registerCommand("supervisor.delete", supervisorIdSchema, async (args, ctx) => {
  await ctx.supervisorMgr.delete(args.id);
  return {};
});

// supervisor.pause
registerCommand("supervisor.pause", supervisorIdSchema, async (args, ctx) => {
  return { supervisor: await ctx.supervisorMgr.pause(args.id) };
});

// supervisor.resume
registerCommand("supervisor.resume", supervisorIdSchema, async (args, ctx) => {
  return { supervisor: await ctx.supervisorMgr.resume(args.id) };
});

// supervisor.trigger
registerCommand("supervisor.trigger", supervisorIdSchema, async (args, ctx) => {
  return { cycle: await ctx.supervisorMgr.triggerEvaluation(args.id) };
});

registerCommand("supervisor.restore", restoreSupervisorSchema, async (args, ctx) => {
  return {
    supervisor: await ctx.supervisorMgr.restore({
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      sourceTargetId: args.sourceTargetId,
      evaluatorProviderId: args.evaluatorProviderId,
      evaluatorModel: args.evaluatorModel,
      maxSupervisionCount: args.maxSupervisionCount,
      scheduledAt: args.scheduledAt,
    }),
  };
});
