import type { ProviderEvent } from '@coder-studio/core';

/**
 * Parse Claude Code hook event payloads
 * Handles SessionStart and Stop events from Claude CLI
 */
export function parseClaudeEvent(
  event: string,
  payload: unknown
): ProviderEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const sessionId = extractSessionId(data);

  switch (event) {
    case 'SessionStart':
      return {
        type: 'session_start',
        sessionId,
        payload: {
          resumeId: sessionId,
          transcriptPath: data.transcript_path,
        },
      };

    case 'Stop':
      return {
        type: 'stop',
        sessionId,
        payload: {
          reason: data.stop_hook_reason,
        },
      };

    default:
      return null;
  }
}

/**
 * Extract session ID from various payload formats
 * Claude may pass session_id in different locations
 */
function extractSessionId(data: Record<string, unknown>): string {
  // Priority 1: Direct session_id field
  if (typeof data.session_id === 'string') {
    return data.session_id;
  }

  // Priority 2: Nested in session object
  if (
    data.session &&
    typeof data.session === 'object' &&
    !Array.isArray(data.session)
  ) {
    const session = data.session as Record<string, unknown>;
    if (typeof session.id === 'string') {
      return session.id;
    }
  }

  // Priority 3: Environment variable (CODER_STUDIO_SESSION_ID)
  // This is set by buildCommand and may be available in env
  if (typeof data.env === 'object' && !Array.isArray(data.env)) {
    const env = data.env as Record<string, unknown>;
    if (typeof env.CODER_STUDIO_SESSION_ID === 'string') {
      return env.CODER_STUDIO_SESSION_ID;
    }
  }

  // Fallback: empty string (will be handled by session manager)
  return '';
}

/**
 * Validate SessionStart payload structure
 */
export function validateSessionStartPayload(
  payload: unknown
): payload is { session_id: string; transcript_path?: string } {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const data = payload as Record<string, unknown>;
  return typeof data.session_id === 'string';
}

/**
 * Validate Stop payload structure
 */
export function validateStopPayload(
  payload: unknown
): payload is { session_id: string; stop_hook_reason?: string } {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const data = payload as Record<string, unknown>;
  return typeof data.session_id === 'string';
}
