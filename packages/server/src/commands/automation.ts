import {
  type AutomationPermission,
  buildIdentifyResult,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listAutomationCapabilities,
} from "@coder-studio/core";
import { z } from "zod";
import { getSessionTokenRequestAuthContext, registerCommand } from "../ws/dispatch.js";

function getEffectivePermissions(
  requestedPermissions: readonly string[] | undefined,
  ctx: Parameters<typeof registerCommand>[2] extends (
    args: unknown,
    ctx: infer T,
    clientId?: string
  ) => Promise<unknown>
    ? T
    : never,
  clientId?: string
): readonly string[] {
  const authContext = getSessionTokenRequestAuthContext(ctx, clientId);
  if (!authContext) {
    return requestedPermissions ?? DEFAULT_AGENT_AUTOMATION_PERMISSIONS;
  }

  if (!requestedPermissions) {
    return authContext.permissions;
  }

  const allowed = new Set<AutomationPermission>(authContext.permissions);
  return requestedPermissions.filter((permission) =>
    allowed.has(permission as AutomationPermission)
  );
}

registerCommand(
  "automation.identify",
  z.object({
    env: z.record(z.string(), z.string().optional()).optional(),
    cwd: z.string().optional(),
  }),
  async (args) => {
    return buildIdentifyResult(args);
  }
);

registerCommand(
  "automation.capabilities",
  z.object({
    permissions: z.array(z.string()).optional(),
  }),
  async (args, ctx, clientId) => {
    return {
      version: 1,
      commands: listAutomationCapabilities({
        permissions: getEffectivePermissions(args.permissions, ctx, clientId),
      }),
    };
  }
);
