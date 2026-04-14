// Provider definitions
export { claudeDefinition } from './claude/definition.js';
export { codexDefinition } from './codex/definition.js';

// Provider registry
export {
  providerRegistry,
  getProviderById,
  isValidProviderId,
  getAllProviderIds,
  getProvidersByCapability,
} from './registry.js';

// Claude-specific exports
export { claudeConfigSchema, type ClaudeConfig } from './claude/config-schema.js';
export { parseClaudeEvent } from './claude/event-parser.js';
export { claudeHooksDescriptor } from './claude/hooks-template.js';

// Codex-specific exports
export {
  extractSessionId,
  detectIdlePrompt,
  isValidSessionId,
  detectCompletion,
  sessionIdPatterns,
  idlePromptPatterns,
  idleDebounceMs,
} from './codex/stdout-heuristics.js';
