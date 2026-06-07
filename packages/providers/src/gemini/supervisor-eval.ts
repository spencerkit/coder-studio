import type { ProviderConfig, SupervisorEvalCommandRequest } from "@coder-studio/core";
import { geminiConfigSchema } from "./config-schema.js";

export function buildGeminiSupervisorEvalCommand(
  config: ProviderConfig,
  req: SupervisorEvalCommandRequest
) {
  const cfg = geminiConfigSchema.parse(config);
  const model = req.model ?? cfg.model;

  return {
    argv: [
      "gemini",
      "--prompt",
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
