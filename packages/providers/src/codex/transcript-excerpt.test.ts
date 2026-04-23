import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexTranscriptExcerpt } from './transcript-excerpt.js';

describe('readCodexTranscriptExcerpt', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codex-transcript-'));
    transcriptPath = join(tempDir, 'rollout.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'message',
          role: 'user',
          content: 'Implement the evaluator runner',
          turn_id: 'turn-9',
        }),
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          content: 'Implemented a spawn-based runner with timeout.',
          turn_id: 'turn-9',
        }),
      ].join('\n')
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns excerpt text and lastTurnId', async () => {
    const result = await readCodexTranscriptExcerpt({
      transcriptPath,
      maxChars: 500,
      maxTurns: 5,
    });

    expect(result?.excerpt).toContain('spawn-based runner');
    expect(result?.lastTurnId).toBe('turn-9');
  });
});
