import type { ProviderConfig, SupervisorEvalCommandRequest } from "@coder-studio/core";
import { cursorConfigSchema } from "./config-schema.js";

export function buildCursorSupervisorEvalCommand(
  config: ProviderConfig,
  req: SupervisorEvalCommandRequest
) {
  const cfg = cursorConfigSchema.parse(config);
  const model = req.model ?? cfg.model;

  return {
    argv: [
      "agent",
      "--print",
      req.prompt,
      "--output-format",
      "json",
      ...(model ? ["--model", model] : []),
    ],
    cwd: req.workspacePath,
    env: {
      ...cfg.envVars,
      CODER_STUDIO_SESSION_ID: req.sessionId,
    },
    outputFile: req.outputFile,
  };
}
