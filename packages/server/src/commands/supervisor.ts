import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

const supervisorObjectiveSchema = z.string().trim().min(1).max(4000);
const createSupervisorSchema = z
  .object({
    sessionId: z.string(),
    workspaceId: z.string(),
    objective: supervisorObjectiveSchema,
    evaluatorProviderId: z.string(),
  })
  .strict();
const updateSupervisorSchema = z
  .object({
    id: z.string(),
    objective: supervisorObjectiveSchema.optional(),
    evaluatorProviderId: z.string().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.objective !== undefined || input.evaluatorProviderId !== undefined,
    'objective or evaluatorProviderId is required'
  );
const sessionIdSchema = z.object({ sessionId: z.string() });
const supervisorIdSchema = z.object({ id: z.string() });

// supervisor.create
registerCommand<z.infer<typeof createSupervisorSchema>, { supervisor: unknown }>(
  'supervisor.create',
  createSupervisorSchema,
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
registerCommand<z.infer<typeof sessionIdSchema>, { supervisor: unknown | null }>(
  'supervisor.get',
  sessionIdSchema,
  async (args, ctx) => {
    return { supervisor: ctx.supervisorMgr.getBySession(args.sessionId) ?? null };
  }
);

// supervisor.update
registerCommand<z.infer<typeof updateSupervisorSchema>, { supervisor: unknown }>(
  'supervisor.update',
  updateSupervisorSchema,
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
registerCommand<z.infer<typeof supervisorIdSchema>, Record<string, never>>(
  'supervisor.delete',
  supervisorIdSchema,
  async (args, ctx) => {
    await ctx.supervisorMgr.delete(args.id);
    return {};
  }
);

// supervisor.pause
registerCommand<z.infer<typeof supervisorIdSchema>, { supervisor: unknown }>(
  'supervisor.pause',
  supervisorIdSchema,
  async (args, ctx) => {
    return { supervisor: await ctx.supervisorMgr.pause(args.id) };
  }
);

// supervisor.resume
registerCommand<z.infer<typeof supervisorIdSchema>, { supervisor: unknown }>(
  'supervisor.resume',
  supervisorIdSchema,
  async (args, ctx) => {
    return { supervisor: await ctx.supervisorMgr.resume(args.id) };
  }
);

// supervisor.trigger
registerCommand<z.infer<typeof supervisorIdSchema>, { cycle: unknown }>(
  'supervisor.trigger',
  supervisorIdSchema,
  async (args, ctx) => {
    return { cycle: await ctx.supervisorMgr.triggerEvaluation(args.id) };
  }
);
