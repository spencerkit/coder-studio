/**
 * Session Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// session.create
registerCommand(
  'session.create',
  z.object({
    workspaceId: z.string(),
    providerId: z.string(),
    draft: z.string().optional(),
  }),
  async (args, ctx) => {
    // Verify workspace exists
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    // TODO: Verify provider exists
    // const provider = ctx.providerRegistry.get(args.providerId);
    // if (!provider) {
    //   throw new Error(`Provider not found: ${args.providerId}`);
    // }

    // Create session
    const session = await ctx.db.session.create({
      workspaceId: args.workspaceId,
      providerId: args.providerId,
      state: 'idle',
      draft: args.draft,
    });

    // TODO: Notify SessionManager to start session
    // await ctx.sessionMgr.start(session.id);

    return session;
  }
);

// session.stop
registerCommand(
  'session.stop',
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    const session = await ctx.db.session.findById(args.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    // TODO: Stop session via SessionManager
    // await ctx.sessionMgr.stop(args.sessionId);

    // Update session state
    await ctx.db.session.update(args.sessionId, {
      state: 'stopped',
    });
  }
);

// session.remove
registerCommand(
  'session.remove',
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    const session = await ctx.db.session.findById(args.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    // Only allow removal if session is stopped
    if (session.state !== 'stopped' && session.state !== 'error') {
      throw new Error(`Cannot remove session in state: ${session.state}`);
    }

    await ctx.db.session.delete(args.sessionId);
  }
);

// session.resume
registerCommand(
  'session.resume',
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    const session = await ctx.db.session.findById(args.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    // TODO: Resume session via SessionManager
    // await ctx.sessionMgr.resume(args.sessionId);

    // Update session state
    await ctx.db.session.update(args.sessionId, {
      state: 'running',
    });

    return session;
  }
);
