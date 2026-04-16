import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// supervisor.create
registerCommand(
  'supervisor.create',
  z.object({
    sessionId: z.string(),
    workspaceId: z.string(),
    objective: z.string().min(1),
    intervalMs: z.number().positive().optional(),
  }),
  async (args, ctx) => {
    return {
      supervisor: await ctx.supervisorMgr.create({
        sessionId: args.sessionId,
        workspaceId: args.workspaceId,
        objective: args.objective,
        intervalMs: args.intervalMs,
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
  z.object({
    id: z.string(),
    objective: z.string().optional(),
    intervalMs: z.number().positive().optional(),
  }),
  async (args, ctx) => {
    return {
      supervisor: await ctx.supervisorMgr.update(args.id, {
        objective: args.objective,
        intervalMs: args.intervalMs,
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