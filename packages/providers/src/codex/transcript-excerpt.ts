import { readFile } from 'node:fs/promises';
import type { TranscriptExcerptRequest } from '@coder-studio/core';

interface TranscriptRecord {
  role: string;
  text: string;
  turnId?: string;
}

export async function readCodexTranscriptExcerpt(req: TranscriptExcerptRequest) {
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
    const text = extractCodexText(record.content);
    if (!text) {
      return null;
    }

    return {
      role: typeof record.role === 'string' ? record.role : 'unknown',
      text,
      turnId: typeof record.turn_id === 'string' ? record.turn_id : undefined,
    };
  } catch {
    return null;
  }
}

function extractCodexText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts = content.flatMap((part) => {
    if (typeof part === 'string') {
      return [part];
    }
    if (!part || typeof part !== 'object') {
      return [];
    }

    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string' && text.length > 0) {
      return [text];
    }

    const nestedContent = (part as { content?: unknown }).content;
    return typeof nestedContent === 'string' && nestedContent.length > 0 ? [nestedContent] : [];
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
