import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionTranscriptReader } from "../session-analysis/transcript-reader.js";

describe("createSessionTranscriptReader", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a codex transcript by session id", async () => {
    const root = join(tmpdir(), `session-analysis-codex-${Date.now()}`);
    tempDirs.push(root);
    mkdirSync(join(root, "2026", "06", "02"), { recursive: true });
    const filePath = join(root, "2026", "06", "02", "rollout-2026-06-02T10-00-00-sess-123.jsonl");
    writeFileSync(filePath, '{"type":"session_meta"}\n');

    const readTranscript = createSessionTranscriptReader({ codexRoot: root });
    await expect(readTranscript({ providerId: "codex", sessionId: "sess-123" })).resolves.toEqual({
      providerId: "codex",
      sessionId: "sess-123",
      path: filePath,
      content: '{"type":"session_meta"}\n',
    });
  });

  it("reads a claude transcript by session id", async () => {
    const root = join(tmpdir(), `session-analysis-claude-${Date.now()}`);
    tempDirs.push(root);
    mkdirSync(join(root, "project-a"), { recursive: true });
    const filePath = join(root, "project-a", "sess-456.jsonl");
    writeFileSync(filePath, '{"type":"user"}\n');

    const readTranscript = createSessionTranscriptReader({ claudeRoot: root });
    await expect(readTranscript({ providerId: "claude", sessionId: "sess-456" })).resolves.toEqual({
      providerId: "claude",
      sessionId: "sess-456",
      path: filePath,
      content: '{"type":"user"}\n',
    });
  });

  it("returns a typed error when the provider is unsupported or the transcript is missing", async () => {
    const root = join(tmpdir(), `session-analysis-missing-${Date.now()}`);
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });

    const readTranscript = createSessionTranscriptReader({
      codexRoot: root,
      claudeRoot: root,
    });

    await expect(
      readTranscript({ providerId: "cursor", sessionId: "sess-1" })
    ).rejects.toMatchObject({
      code: "session_analysis_transcript_unsupported",
    });
    await expect(
      readTranscript({ providerId: "codex", sessionId: "missing" })
    ).rejects.toMatchObject({
      code: "session_analysis_transcript_missing",
    });
  });
});
