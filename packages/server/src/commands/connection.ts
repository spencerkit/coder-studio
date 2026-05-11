import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("connection.probe", z.object({}).default({}), async () => {
  return { ok: true as const };
});
