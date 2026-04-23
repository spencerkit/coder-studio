import { readFile } from 'node:fs/promises';
import type { TranscriptExcerptRequest } from '@coder-studio/core';

interface TranscriptRecord {
  role: string;
  text: string;
  turnId?: string;
}

export async function readClaudeTranscriptExcerpt(req: TranscriptExcerptRequest) {
  try {
    const content = await readFile(req.transcriptPath, 'utf8');
    const records = content
      .split('\n')
      .filter(Boolean)
      .map(parseLine)
      .filter((record): record is TranscriptRecord => record !== null);

    const recentRecords = selectRecentTurns(records, req.maxTurns);
    const excerpt = recentRecords
      .map((record) => `${record.role}: ${record.text}`)
      .join('\n\n')
      .slice(-req.maxChars);

    if (!excerpt) {
      return null;
    }

    return {
      excerpt,
      lastTurnId: recentRecords.at(-1)?.turnId,
    };
  } catch {
    return null;
  }
}

function parseLine(line: string): TranscriptRecord | null {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const role = typeof record.type === 'string' ? record.type : 'unknown';
    const turnId = typeof record.turn_id === 'string' ? record.turn_id : undefined;
    const text = extractClaudeText(record.message);

    return text ? { role, text, turnId } : null;
  } catch {
    return null;
  }
}

function extractClaudeText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }

  const parts = content.flatMap((part) => {
    if (!part || typeof part !== 'object') {
      return [];
    }
    if ((part as { type?: unknown }).type !== 'text') {
      return [];
    }
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' && text.length > 0 ? [text] : [];
  });

  return parts.join('\n');
}

function selectRecentTurns(records: TranscriptRecord[], maxTurns: number): TranscriptRecord[] {
  if (maxTurns <= 0) {
    return [];
  }

  const selected: TranscriptRecord[] = [];
  const seenTurns = new Set<string>();

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    const turnKey = record.turnId ?? `record-${index}`;
    if (!seenTurns.has(turnKey)) {
      if (seenTurns.size >= maxTurns) {
        break;
      }
      seenTurns.add(turnKey);
    }

    selected.unshift(record);
  }

  return selected;
}
