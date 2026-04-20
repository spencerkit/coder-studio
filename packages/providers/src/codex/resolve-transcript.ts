import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import type { Session } from '@coder-studio/core';

/**
 * Resolve Codex transcript (rollout) path by scanning ~/.codex/sessions/.
 *
 * Codex writes rollout files under:
 *   ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<thread-id>.jsonl
 *
 * Strategy: walk the last 7 days of directories looking for files that
 * end with the session's resumeId (which matches the thread-id).
 * Returns the first match found or null.
 *
 * Must not throw.
 */
export async function resolveCodexTranscriptPath(session: Session): Promise<string | null> {
  const threadId = session.resumeId;
  if (!threadId) return null;

  try {
    const home = process.env.HOME || '';
    if (!home) return null;

    const sessionsDir = join(home, '.codex', 'sessions');
    if (!existsSync(sessionsDir)) return null;

    const now = new Date();
    // Search last 7 days
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const yyyy = String(d.getFullYear());
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dayDir = join(sessionsDir, yyyy, mm, dd);

      if (!existsSync(dayDir)) continue;

      const files = readdirSync(dayDir);
      for (const f of files) {
        if (f.endsWith(`-${threadId}.jsonl`) && f.startsWith('rollout-')) {
          return join(dayDir, f);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
