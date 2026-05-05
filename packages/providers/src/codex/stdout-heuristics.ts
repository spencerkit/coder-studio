/**
 * Codex stdout heuristics for session detection
 * Limited mode: extracts session ID and detects idle state from stdout
 */

/**
 * Session ID extraction patterns
 * Matches various formats Codex may output
 */
export const sessionIdPatterns: RegExp[] = [
  // Format: "Session ID: abc123-def456"
  /Session ID:\s*([a-f0-9-]{6,})/i,

  // Format: "session: abc123"
  /^session:\s*([a-f0-9-]{6,})/im,

  // Format: "[session-abc123]"
  /\[session-([a-f0-9-]{6,})\]/i,

  // Format: JSON-like: {"session_id": "abc123"}
  /"session_id":\s*"([a-f0-9-]{6,})"/i,
];

/**
 * Idle prompt detection patterns
 * Matches when Codex is waiting for user input
 */
export const idlePromptPatterns: RegExp[] = [
  // Standard prompt: newline + "> " or "$ "
  /\n>\s*$/,
  /\n\$\s*$/,

  // Codex-specific: newline + ">>> "
  /\n>>>\s*$/,

  // Prompt with cursor indicator
  /\n.*\u2588\s*$/, // █ cursor
];

/**
 * Idle detection debounce time
 * Wait this long after detecting idle pattern before marking as idle
 */
export const idleDebounceMs = 3000;

/**
 * Extract session ID from stdout buffer
 * Returns first matched session ID or null
 */
export function extractSessionId(buffer: string): string | null {
  // Keep last 4096 chars for pattern matching
  const recent = buffer.slice(-4096);

  for (const pattern of sessionIdPatterns) {
    const matches = recent.match(pattern);
    if (matches && matches[1]) {
      return matches[1];
    }
  }

  return null;
}

/**
 * Check if stdout indicates idle state
 * Returns true if idle prompt pattern detected
 */
export function detectIdlePrompt(buffer: string): boolean {
  const recent = buffer.slice(-4096);

  for (const pattern of idlePromptPatterns) {
    if (pattern.test(recent)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate extracted session ID format
 * Ensures ID meets minimum requirements
 */
export function isValidSessionId(id: string): boolean {
  // Minimum 6 chars, alphanumeric + dashes
  return /^[a-f0-9-]{6,}$/i.test(id);
}

/**
 * Parse completion indicator from stdout
 * May detect explicit completion messages
 */
export function detectCompletion(buffer: string): boolean {
  const recent = buffer.slice(-2048);

  // Common completion indicators
  const completionPatterns = [
    /\n(complete|finished|done)\s*\.\s*$/i,
    /✓\s*$/, // Checkmark at end
    /Task completed/i,
    /\n(complete|finished|done)\s*$/i,
  ];

  return completionPatterns.some((pattern) => pattern.test(recent));
}
