import type { ProviderConfig, SupervisorEvalCommandRequest } from '@coder-studio/core';
import { claudeConfigSchema } from './config-schema.js';

export function buildClaudeSupervisorEvalCommand(
  config: ProviderConfig,
  req: SupervisorEvalCommandRequest
) {
  const cfg = claudeConfigSchema.parse(config);
  const model = req.model ?? cfg.model;

  return {
    argv: [
      'claude',
      '-p',
      req.prompt,
      '--output-format',
      'json',
      ...(model ? ['--model', model] : []),
      ...(cfg.additionalArgs ?? []),
    ],
    cwd: req.workspacePath,
    env: {
      ...(cfg.envVars ?? {}),
      ...(req.apiKey ? { ANTHROPIC_API_KEY: req.apiKey } : {}),
      CODER_STUDIO_SESSION_ID: req.sessionId,
    },
  };
}
