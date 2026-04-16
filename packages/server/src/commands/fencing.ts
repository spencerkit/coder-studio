/**
 * Fencing command handlers (Phase 3)
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// fencing.request - Request controller status
registerCommand(
  'fencing.request',
  z.object({
    workspaceId: z.string(),
    tabId: z.string(),
  }),
  async (args, ctx, clientId) => {
    // Note: in Phase 1, request.ip/userAgent come from WsHub connection
    // For now, use placeholder — will be refined when WsHub integration is done
    const mockReq = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'coder-studio-client' },
    } as any;
    return ctx.fencingMgr.requestControl(
      args.workspaceId,
      clientId!,
      args.tabId,
      mockReq
    );
  }
);

// fencing.heartbeat - Send heartbeat
registerCommand(
  'fencing.heartbeat',
  z.object({ workspaceId: z.string() }),
  async (args, ctx, clientId) => {
    const success = ctx.fencingMgr.heartbeat(args.workspaceId, clientId!);
    return { success };
  }
);

// fencing.release - Release controller status
registerCommand(
  'fencing.release',
  z.object({ workspaceId: z.string() }),
  async (args, ctx, clientId) => {
    ctx.fencingMgr.release(args.workspaceId, clientId!);
    return {};
  }
);

// fencing.status - Get current controller status
registerCommand(
  'fencing.status',
  z.object({ workspaceId: z.string() }),
  async (args, ctx) => {
    const controller = ctx.fencingMgr.getController(args.workspaceId);
    const isUnresponsive = ctx.fencingMgr.isControllerUnresponsive(args.workspaceId);
    return {
      isController: controller != null,
      controller: controller
        ? { tabId: controller.tabId, issuedAt: controller.issuedAt }
        : null,
      isUnresponsive,
    };
  }
);

// fencing.takeover - Force takeover when controller is unresponsive
registerCommand(
  'fencing.takeover',
  z.object({
    workspaceId: z.string(),
    tabId: z.string(),
  }),
  async (args, ctx, clientId) => {
    const mockReq = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'coder-studio-client' },
    } as any;
    return ctx.fencingMgr.forceTakeover(
      args.workspaceId,
      clientId!,
      args.tabId,
      mockReq
    );
  }
);
