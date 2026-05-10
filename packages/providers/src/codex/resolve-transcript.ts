import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";

interface ResolveCodexTranscriptSession {
  transcriptPath?: string;
  providerSessionId?: string;
}

interface ResolveCodexTranscriptOptions {
  sessionsRoot?: string;
}

interface TranscriptCandidate {
  path: string;
  mtimeMs: number;
}

function findTranscriptCandidates(root: string, suffix: string): TranscriptCandidate[] {
  const candidates: TranscriptCandidate[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(suffix) &&
        entry.name.endsWith(".jsonl")
      ) {
        try {
          candidates.push({
            path: entryPath,
            mtimeMs: statSync(entryPath).mtimeMs,
          });
        } catch {
          continue;
        }
      }
    }
  }

  return candidates;
}

export function resolveCodexTranscriptPath(
  session: ResolveCodexTranscriptSession,
  options: ResolveCodexTranscriptOptions = {}
): string | undefined {
  if (session.transcriptPath) {
    return session.transcriptPath;
  }

  if (!session.providerSessionId) {
    return undefined;
  }

  const sessionsRoot = options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) {
    return undefined;
  }

  const suffix = `-${session.providerSessionId}.jsonl`;
  const candidates = findTranscriptCandidates(sessionsRoot, suffix).sort(
    (left, right) =>
      right.mtimeMs - left.mtimeMs || basename(right.path).localeCompare(basename(left.path))
  );

  return candidates[0]?.path;
}
