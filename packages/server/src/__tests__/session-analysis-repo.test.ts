import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SessionAnalysisRecord,
  SessionAnalysisRepo,
} from "../storage/repositories/session-analysis-repo.js";

describe("SessionAnalysisRepo", () => {
  let repo: SessionAnalysisRepo;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "session-analysis-repo-test-"));
    repo = new SessionAnalysisRepo({
      filePath: join(tempDir, "session-analysis.json"),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns undefined for a missing session", () => {
    expect(repo.findBySessionId("missing-session")).toBeUndefined();
  });

  it("persists and reloads a session analysis record by session id", () => {
    const record: SessionAnalysisRecord = {
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      status: "succeeded",
      requestedAt: 1000,
      completedAt: 1200,
      inputDigest: "digest-123",
      result: {
        summary: "The session made progress after clarifying repo boundaries.",
        recentWork: ["Reviewed adjacent repos", "Added focused tests"],
        repeatedTopics: [
          {
            topic: "TDD ordering",
            whyItRepeated: "The plan explicitly required test-first execution.",
            evidence: ["Wrote the repo test before implementation", "Ran the focused test twice"],
          },
        ],
        bottlenecks: [
          {
            title: "Plan visibility",
            impact: "The first cut inferred fields that later tasks do not use.",
            evidence: [
              "Initial record shape used createdAt/updatedAt",
              "Spec alignment required a rewrite",
            ],
            suggestion: "Keep the persisted contract limited to the confirmed plan.",
          },
        ],
        skillCandidates: [
          {
            title: "Plan audit",
            why: "Future tasks depend on this schema staying exact.",
            suggestedScope: "Validate record shape before wiring commands.",
            evidence: ["Downstream tasks read SessionAnalysisResult directly"],
          },
        ],
        openLoops: ["Need command-layer wiring in a later task"],
        wrapUpSuggestions: ["Add command tests once the repo is consumed by the manager"],
        confidence: "medium",
      },
    };

    repo.upsert(record);

    const reloadedRepo = new SessionAnalysisRepo({
      filePath: join(tempDir, "session-analysis.json"),
    });

    expect(reloadedRepo.findBySessionId("sess-1")).toEqual(record);
  });
});
