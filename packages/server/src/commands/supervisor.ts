import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

const supervisorObjectiveSchema = z.string().trim().min(1).max(4000);

// supervisor.create
registerCommand(
  'supervisor.create',
  z
    .object({
      sessionId: z.string(),
      workspaceId: z.string(),
      objective: supervisorObjectiveSchema,
      evaluatorProviderId: z.string(),
    })
    .strict(),
  async (args, ctx) => {
    return {
      supervisor: await ctx.supervisorMgr.create({
        sessionId: args.sessionId,
        workspaceId: args.workspaceId,
        objective: args.objective,
        evaluatorProviderId: args.evaluatorProviderId,
      }),
    };
  }
);

// supervisor.get
registerCommand(
  'supervisor.get',
  z.object({ sessionId: z.string() }),
  async (args, ctx) => {
    return { supervisor: ctx.supervisorMgr.getBySession(args.sessionId) ?? null };
  }
);

// supervisor.update
registerCommand(
  'supervisor.update',
  z
    .object({
      id: z.string(),
      objective: supervisorObjectiveSchema.optional(),
      evaluatorProviderId: z.string().optional(),
    })
    .strict()
    .refine(
      (input) =>
        input.objective !== undefined ||
        input.evaluatorProviderId !== undefined,
      'objective or evaluatorProviderId is required'
    ),
  async (args, ctx) => {
    return {
      supervisor: await ctx.supervisorMgr.update(args.id, {
        objective: args.objective,
        evaluatorProviderId: args.evaluatorProviderId,
      }),
    };
  }
);

// supervisor.delete
registerCommand(
  'supervisor.delete',
  z.object({ id: z.string() }),
  async (args, ctx) => {
    await ctx.supervisorMgr.delete(args.id);
    return {};
  }
);

// supervisor.pause
registerCommand(
  'supervisor.pause',
  z.object({ id: z.string() }),
  async (args, ctx) => {
    return { supervisor: await ctx.supervisorMgr.pause(args.id) };
  }
);

// supervisor.resume
registerCommand(
  'supervisor.resume',
  z.object({ id: z.string() }),
  async (args, ctx) => {
    return { supervisor: await ctx.supervisorMgr.resume(args.id) };
  }
);

// supervisor.trigger
registerCommand(
  'supervisor.trigger',
  z.object({ id: z.string() }),
  async (args, ctx) => {
    return { cycle: await ctx.supervisorMgr.triggerEvaluation(args.id) };
  }
);
