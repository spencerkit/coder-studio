// Provider definitions

// Claude-specific exports
export { type ClaudeConfig, claudeConfigSchema } from "./claude/config-schema.js";
export { claudeDefinition } from "./claude/definition.js";
// Codex-specific exports
export { type CodexConfig, codexConfigSchema } from "./codex/config-schema.js";
export { codexDefinition } from "./codex/definition.js";
export {
  detectCompletion,
  detectIdlePrompt,
  extractSessionId,
  idleDebounceMs,
  idlePromptPatterns,
  isValidSessionId,
  sessionIdPatterns,
} from "./codex/stdout-heuristics.js";
// Provider registry
export {
  getAllProviderIds,
  getProviderById,
  getProvidersByCapability,
  isValidProviderId,
  providerRegistry,
} from "./registry.js";
