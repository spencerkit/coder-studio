import type {
  ProviderConfig,
  ProviderHeadlessCommandRequest,
  ProviderHeadlessDefinition,
  ProviderHeadlessScenario,
} from "@coder-studio/core";
import { buildCodexSupervisorEvalCommand } from "./supervisor-eval.js";

function buildCodexHeadlessCommand(
  config: ProviderConfig,
  scenario: ProviderHeadlessScenario,
  req: ProviderHeadlessCommandRequest
) {
  switch (scenario) {
    case "supervisor_eval":
    case "agent_instructions_generate":
    case "session_analysis":
      return buildCodexSupervisorEvalCommand(config, req);
    default:
      return null;
  }
}

export const codexHeadlessDefinition: ProviderHeadlessDefinition = {
  supportedScenarios: ["supervisor_eval", "agent_instructions_generate", "session_analysis"],
  buildCommand: buildCodexHeadlessCommand,
};
