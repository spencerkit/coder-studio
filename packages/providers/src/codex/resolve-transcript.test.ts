import { mkdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCodexTranscriptPath } from "./resolve-transcript.js";

describe("resolveCodexTranscriptPath", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function createSessionsRoot(): string {
    const root = join(
      tmpdir(),
      `coder-studio-codex-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(root, { recursive: true });
    tempDirs.push(root);
    return root;
  }

  it("returns the persisted transcript path when one is already present", () => {
    expect(
      resolveCodexTranscriptPath({
        transcriptPath: "/tmp/existing.jsonl",
        providerSessionId: "thread-1",
      })
    ).toBe("/tmp/existing.jsonl");
  });

  it("returns undefined when providerSessionId is absent", () => {
    const sessionsRoot = createSessionsRoot();

    expect(resolveCodexTranscriptPath({}, { sessionsRoot })).toBeUndefined();
  });

  it("returns undefined when the Codex sessions directory does not exist", () => {
    expect(
      resolveCodexTranscriptPath(
        { providerSessionId: "thread-1" },
        { sessionsRoot: join(tmpdir(), "missing-codex-sessions-root") }
      )
    ).toBeUndefined();
  });

  it("finds the newest rollout transcript matching the provider session id", () => {
    const sessionsRoot = createSessionsRoot();
    const olderDir = join(sessionsRoot, "2026", "05", "09");
    const newerDir = join(sessionsRoot, "2026", "05", "10");
    mkdirSync(olderDir, { recursive: true });
    mkdirSync(newerDir, { recursive: true });

    const olderPath = join(olderDir, "rollout-older-thread-1.jsonl");
    const newerPath = join(newerDir, "rollout-newer-thread-1.jsonl");
    const otherPath = join(newerDir, "rollout-other-thread-2.jsonl");
    writeFileSync(olderPath, "{}\n");
    writeFileSync(newerPath, "{}\n");
    writeFileSync(otherPath, "{}\n");
    utimesSync(olderPath, new Date("2026-05-09T00:00:00Z"), new Date("2026-05-09T00:00:00Z"));
    utimesSync(newerPath, new Date("2026-05-10T00:00:00Z"), new Date("2026-05-10T00:00:00Z"));

    expect(resolveCodexTranscriptPath({ providerSessionId: "thread-1" }, { sessionsRoot })).toBe(
      newerPath
    );
  });
});
