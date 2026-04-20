import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('resolveCodexTranscriptPath', () => {
  let tempHome: string;
  let sessionsDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'cs-resolve-'));
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    sessionsDir = join(tempHome, '.codex', 'sessions', yyyy, mm, dd);
    mkdirSync(sessionsDir, { recursive: true });

    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
    // Clear the module cache so it picks up the new HOME
    vi.resetModules();
  });

  it('returns null when no resumeId', async () => {
    const { resolveCodexTranscriptPath } = await import('./resolve-transcript.js');
    const result = await resolveCodexTranscriptPath({ id: 's1', resumeId: undefined } as any);
    expect(result).toBeNull();
  });

  it('finds the rollout file when it exists', async () => {
    const { resolveCodexTranscriptPath } = await import('./resolve-transcript.js');
    const threadId = 'abc-123';
    const filepath = join(sessionsDir, `rollout-2026-04-20T10-${threadId}.jsonl`);
    writeFileSync(filepath, '{"turn": 1}\n');

    const session = { id: 's1', resumeId: threadId } as any;
    const result = await resolveCodexTranscriptPath(session);
    expect(result).toBe(filepath);
  });

  it('returns null when no matching file', async () => {
    const { resolveCodexTranscriptPath } = await import('./resolve-transcript.js');
    const session = { id: 's1', resumeId: 'no-such-thread' } as any;
    const result = await resolveCodexTranscriptPath(session);
    expect(result).toBeNull();
  });
});
