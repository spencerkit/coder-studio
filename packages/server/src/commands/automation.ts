import {
  buildIdentifyResult,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listAutomationCapabilities,
} from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

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
  async (args) => {
    return {
      version: 1,
      commands: listAutomationCapabilities({
        permissions: args.permissions ?? DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
      }),
    };
  }
);
