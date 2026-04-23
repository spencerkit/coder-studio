import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeTranscriptExcerpt } from './transcript-excerpt.js';

describe('readClaudeTranscriptExcerpt', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-transcript-'));
    transcriptPath = join(tempDir, 'session.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Build the repo layer' }] },
          turn_id: 'turn-1',
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Created supervisor repo and cycle repo.' }] },
          turn_id: 'turn-1',
        }),
      ].join('\n')
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns excerpt text and lastTurnId', async () => {
    const result = await readClaudeTranscriptExcerpt({
      transcriptPath,
      maxChars: 500,
      maxTurns: 5,
    });

    expect(result?.excerpt).toContain('Created supervisor repo and cycle repo.');
    expect(result?.lastTurnId).toBe('turn-1');
  });
});
