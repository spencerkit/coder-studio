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
    // Get workspace
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    // TODO: Get provider from registry
    // For now, throw error
    throw { code: 'provider_not_implemented', message: 'Provider registry not yet implemented' };

    // Future implementation:
    // const provider = ctx.providerRegistry.get(args.providerId);
    // if (!provider) {
    //   throw { code: 'unknown_provider', message: `Provider not found: ${args.providerId}` };
    // }
    //
    // return ctx.sessionMgr.create({
    //   workspaceId: args.workspaceId,
    //   workspacePath: workspace.path,
    //   providerId: args.providerId,
    //   provider,
    //   draft: args.draft,
    // });
  }
);

// session.stop
registerCommand(
  'session.stop',
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    await ctx.sessionMgr.stop(args.sessionId);
  }
);

// session.remove
registerCommand(
  'session.remove',
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    // Session removal handled by database layer
    // For now, we just verify the session exists
    const session = ctx.sessionMgr.get(args.sessionId);
    if (!session) {
      throw { code: 'session_not_found', message: `Session not found: ${args.sessionId}` };
    }

    if (session.state !== 'ended' && session.state !== 'unavailable') {
      throw { code: 'invalid_state', message: `Cannot remove session in state: ${session.state}` };
    }

    // TODO: Add delete method to session manager
    throw { code: 'not_implemented', message: 'Session removal not yet implemented' };
  }
);

// session.resume
registerCommand(
  'session.resume',
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    const session = ctx.sessionMgr.get(args.sessionId);
    if (!session) {
      throw { code: 'session_not_found', message: `Session not found: ${args.sessionId}` };
    }

    // TODO: Get provider from registry
    throw { code: 'provider_not_implemented', message: 'Provider registry not yet implemented' };

    // Future implementation:
    // const workspace = ctx.workspaceMgr.get(session.workspaceId);
    // const provider = ctx.providerRegistry.get(session.providerId);
    // return ctx.sessionMgr.resume(args.sessionId, workspace.path, provider);
  }
);
