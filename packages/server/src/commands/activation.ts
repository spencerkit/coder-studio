import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

registerCommand(
  "activation.claim",
  z.object({ clientInstanceId: z.string().min(1) }),
  async (args, ctx, clientId) => {
    if (!clientId) {
      throw {
        code: "activation_request_unavailable",
        message: "Activation claim requires websocket request metadata",
      };
    }

    const request = ctx.broadcaster.getRequestMetadata?.(clientId);
    if (!request) {
      throw {
        code: "activation_request_unavailable",
        message: "Activation claim requires websocket request metadata",
      };
    }

    const claim = ctx.activationMgr.claim(args.clientInstanceId, clientId, request);
    if (claim.displacedWsClientId) {
      ctx.broadcaster.revokeAndCloseClient?.(claim.displacedWsClientId, claim.generation);
    }

    return claim;
  }
);

registerCommand(
  "activation.heartbeat",
  z.object({ clientInstanceId: z.string(), generation: z.number().int().positive() }),
  async (args, ctx, clientId) => {
    const lease = ctx.activationMgr.getLease();
    if (!clientId || !lease || lease.wsClientId !== clientId) {
      return { ok: false };
    }

    return {
      ok: ctx.activationMgr.heartbeat(args.clientInstanceId, args.generation),
    };
  }
);

registerCommand(
  "activation.release",
  z.object({ clientInstanceId: z.string(), generation: z.number().int().positive() }),
  async (args, ctx, clientId) => {
    const lease = ctx.activationMgr.getLease();
    if (!clientId || !lease || lease.wsClientId !== clientId) {
      return { ok: false };
    }

    ctx.activationMgr.release(args.clientInstanceId, args.generation);
    return { ok: true };
  }
);
