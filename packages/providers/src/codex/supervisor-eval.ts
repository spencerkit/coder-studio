import type { ProviderConfig, SupervisorEvalCommandRequest } from "@coder-studio/core";
import { codexConfigSchema } from "./config-schema.js";

/**
 * Build the argv Codex needs to act as a supervisor evaluator.
 *
 * We require `--json` so stdout is a JSONL event stream instead of the
 * default human banner ("OpenAI Codex v…", token usage, etc.). The
 * evaluator extractor then picks the final `item.completed` event of
 * type `agent_message` and parses its `.text` as JSON.
 *
 * We also pin `-s read-only` and `--skip-git-repo-check` so evaluations
 * never mutate the workspace and don't choke when the cwd isn't a repo.
 */
export function buildCodexSupervisorEvalCommand(
  config: ProviderConfig,
  req: SupervisorEvalCommandRequest
) {
  const cfg = codexConfigSchema.parse(config);

  return {
    argv: [
      "codex",
      "exec",
      "--json",
      "-s",
      "read-only",
      "--skip-git-repo-check",
      ...(req.model ? ["-m", req.model] : []),
      ...cfg.additionalArgs,
      req.prompt,
    ],
    cwd: req.workspacePath,
    env: {
      ...cfg.envVars,
      ...(req.apiKey ? { OPENAI_API_KEY: req.apiKey } : {}),
      CODER_STUDIO_SESSION_ID: req.sessionId,
    },
  };
}
