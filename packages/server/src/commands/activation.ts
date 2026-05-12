import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

registerCommand(
  "activation.claim",
  z.object({ clientInstanceId: z.string().min(1) }),
  async (args, ctx, clientId) => {
    return ctx.activationMgr.claim(args.clientInstanceId, clientId!);
  }
);

registerCommand(
  "activation.heartbeat",
  z.object({ clientInstanceId: z.string(), generation: z.number().int().positive() }),
  async (args, ctx) => {
    return { ok: ctx.activationMgr.heartbeat(args.clientInstanceId, args.generation) };
  }
);

registerCommand(
  "activation.release",
  z.object({ clientInstanceId: z.string(), generation: z.number().int().positive() }),
  async (args, ctx) => {
    ctx.activationMgr.release(args.clientInstanceId, args.generation);
    return { ok: true };
  }
);
