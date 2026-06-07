import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const TRANSCRIPT_MAX_CHARS = 120_000;

export interface SessionTranscript {
  providerId: string;
  sessionId: string;
  path: string;
  content: string;
}

export interface SessionTranscriptReaderDeps {
  codexRoot?: string;
  claudeRoot?: string;
}

async function findTranscriptBySessionId(root: string, sessionId: string): Promise<string | null> {
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
        return entryPath;
      }
    }
  }

  return null;
}

function trimTranscript(content: string): string {
  if (content.length <= TRANSCRIPT_MAX_CHARS) {
    return content;
  }

  return content.slice(content.length - TRANSCRIPT_MAX_CHARS);
}

export function createSessionTranscriptReader(deps: SessionTranscriptReaderDeps = {}) {
  const codexRoot = deps.codexRoot ?? path.join(homedir(), ".codex", "sessions");
  const claudeRoot = deps.claudeRoot ?? path.join(homedir(), ".claude", "projects");

  return async function readTranscript(input: {
    providerId: string;
    sessionId: string;
  }): Promise<SessionTranscript> {
    const root =
      input.providerId === "codex" ? codexRoot : input.providerId === "claude" ? claudeRoot : null;

    if (!root) {
      throw {
        code: "session_analysis_transcript_unsupported",
        message: `Transcript reading is not supported for provider: ${input.providerId}`,
      };
    }

    const transcriptPath = await findTranscriptBySessionId(root, input.sessionId);
    if (!transcriptPath) {
      throw {
        code: "session_analysis_transcript_missing",
        message: `Transcript not found for session: ${input.sessionId}`,
      };
    }

    const content = await readFile(transcriptPath, "utf8");
    return {
      providerId: input.providerId,
      sessionId: input.sessionId,
      path: transcriptPath,
      content: trimTranscript(content),
    };
  };
}
