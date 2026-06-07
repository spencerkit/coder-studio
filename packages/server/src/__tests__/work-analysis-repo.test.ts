import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WorkAnalysisRepo } from "../storage/repositories/work-analysis-repo.js";

describe("WorkAnalysisRepo", () => {
  it("stores hourly analysis cache in a SQLite database file instead of JSON text", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const filePath = join(dir, "work-analysis.sqlite");
    const repo = new WorkAnalysisRepo({ filePath });

    repo.upsertHourlyIndex({
      version: 1,
      bucketMode: "hourly_session_slices",
      indexedAt: Date.UTC(2026, 5, 7, 3),
      indexedThroughHourStart: Date.UTC(2026, 5, 7, 2),
      sourceDigest: "hourly-source",
      providerStatuses: [],
      buckets: [],
    });

    const file = readFileSync(filePath);
    expect(file.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");
    expect(() => JSON.parse(file.toString("utf8"))).toThrow();
    expect(new WorkAnalysisRepo({ filePath }).findHourlyIndex()).toMatchObject({
      sourceDigest: "hourly-source",
      buckets: [],
    });
  });

  it("closes the SQLite connection and can reopen the repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const filePath = join(dir, "work-analysis.sqlite");
    const repo = new WorkAnalysisRepo({ filePath });

    repo.upsert({
      id: "analysis-1",
      queryDigest: "digest-1",
      workspacePaths: ["/repo/app"],
      timeRange: { preset: "7d" },
      basicStatus: "succeeded",
      deepStatus: "idle",
    });

    repo.close();
    repo.close();

    const reloaded = new WorkAnalysisRepo({ filePath });
    expect(reloaded.findByQueryDigest("digest-1")).toMatchObject({
      id: "analysis-1",
      queryDigest: "digest-1",
    });
    reloaded.close();
  });

  it("persists and clears the hourly dashboard index", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const repo = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });

    repo.upsertHourlyIndex({
      version: 1,
      indexedAt: Date.UTC(2026, 5, 7, 3),
      indexedThroughHourStart: Date.UTC(2026, 5, 7, 3),
      sourceDigest: "hourly-source",
      providerStatuses: [
        {
          providerId: "codex",
          status: "supported",
          sessionCount: 1,
          parseErrorCount: 0,
          warningCount: 0,
        },
      ],
      buckets: [
        {
          hourStart: Date.UTC(2026, 5, 7, 2),
          sessions: [
            {
              providerId: "codex",
              sessionId: "codex-1",
              workspacePath: "/repo/app",
              startedAt: Date.UTC(2026, 5, 7, 2, 15),
              lastActiveAt: Date.UTC(2026, 5, 7, 2, 45),
              sourceRef: "codex-1",
              userTurnCount: 1,
              assistantTurnCount: 1,
              toolUseCount: 1,
              parseErrorCount: 0,
              timestampQuality: "explicit",
              usage: {
                inputTokens: 80,
                outputTokens: 20,
                totalTokens: 100,
              },
              usageCoverage: {
                hasUsage: true,
                callCount: 1,
                callsWithTotalTokens: 1,
                estimatedCallCount: 0,
              },
              events: [],
            },
          ],
        },
      ],
    });

    const reloaded = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });
    expect(reloaded.findHourlyIndex()).toMatchObject({
      sourceDigest: "hourly-source",
      buckets: [
        {
          hourStart: Date.UTC(2026, 5, 7, 2),
          sessions: [
            {
              sessionId: "codex-1",
              usage: { totalTokens: 100 },
            },
          ],
        },
      ],
    });

    reloaded.clearAnalysisCache();

    expect(reloaded.findHourlyIndex()).toBeUndefined();
    expect(reloaded.findByQueryDigest("missing")).toBeUndefined();
  });

  it("compacts hourly index event details before persisting", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const filePath = join(dir, "work-analysis.sqlite");
    const repo = new WorkAnalysisRepo({ filePath });
    const longText = "debug ".repeat(400);
    const longCommand = "pnpm test ".repeat(400);

    repo.upsertHourlyIndex({
      version: 1,
      indexedAt: Date.UTC(2026, 5, 7, 3),
      indexedThroughHourStart: Date.UTC(2026, 5, 7, 3),
      sourceDigest: "hourly-source",
      providerStatuses: [
        {
          providerId: "codex",
          status: "supported",
          sessionCount: 1,
          parseErrorCount: 0,
          warningCount: 0,
        },
      ],
      buckets: [
        {
          hourStart: Date.UTC(2026, 5, 7, 2),
          sessions: [
            {
              providerId: "codex",
              sessionId: "codex-1",
              workspacePath: "/repo/app",
              startedAt: Date.UTC(2026, 5, 7, 2, 15),
              lastActiveAt: Date.UTC(2026, 5, 7, 2, 45),
              sourceRef: "codex-1",
              userTurnCount: 1,
              assistantTurnCount: 1,
              toolUseCount: 1,
              parseErrorCount: 0,
              timestampQuality: "explicit",
              events: [
                {
                  eventId: "skill-1",
                  providerId: "codex",
                  sessionId: "codex-1",
                  workspacePath: "/repo/app",
                  eventType: "tool",
                  canonicalEventType: "tool_call",
                  toolName: "Skill",
                  toolCategory: "skill",
                  text: longText,
                  commandText: longCommand,
                  payload: { input: { skill: "frontend-design", transcript: "x".repeat(8_000) } },
                  evidence: ["y".repeat(8_000)],
                  rawRefs: ["codex-1"],
                },
              ],
            },
          ],
        },
      ],
    });

    const event = new WorkAnalysisRepo({ filePath }).findHourlyIndex()?.buckets[0]?.sessions[0]
      ?.events?.[0];
    expect(event).toMatchObject({ skillName: "frontend-design" });
    expect(event?.payload).toBeUndefined();
    expect(event?.evidence).toBeUndefined();
    expect(event?.text?.length).toBeLessThan(longText.length);
    expect(event?.commandText?.length).toBeLessThan(longCommand.length);
  });

  it("persists hourly index provider warning details", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const repo = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });

    repo.upsertHourlyIndex({
      version: 1,
      bucketMode: "hourly_session_slices",
      indexedAt: Date.UTC(2026, 5, 7, 3),
      indexedThroughHourStart: Date.UTC(2026, 5, 7, 2),
      sourceDigest: "hourly-source",
      providerStatuses: [
        {
          providerId: "opencode",
          status: "partial",
          sessionCount: 0,
          parseErrorCount: 0,
          warningCount: 1,
          warnings: [
            {
              code: "sqlite_query_failed",
              message: "Failed to query OpenCode SQLite database",
              sourceRef: "/home/user/.local/share/opencode/opencode.db",
            },
          ],
        },
      ],
      buckets: [],
    });

    const reloaded = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });

    expect(reloaded.findHourlyIndex()).toMatchObject({
      providerStatuses: [
        {
          providerId: "opencode",
          warnings: [
            {
              code: "sqlite_query_failed",
              message: "Failed to query OpenCode SQLite database",
              sourceRef: "/home/user/.local/share/opencode/opencode.db",
            },
          ],
        },
      ],
    });
  });

  it("persists and reloads a record by query digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const repo = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });

    repo.upsert({
      id: "analysis-1",
      queryDigest: "digest-1",
      workspacePaths: ["/repo/app"],
      timeRange: { preset: "7d" },
      basicStatus: "succeeded",
      deepStatus: "idle",
      basicResult: {
        availableWorkspacePaths: ["/repo/app"],
        coverage: { workspaceCount: 1 },
        workSurface: { workspacePaths: ["/repo/app"] },
      },
      sourceSnapshot: {
        sourceDigest: "digest-source",
        collectedAt: 1_234,
        providerStatuses: [
          {
            providerId: "codex",
            status: "supported",
            sessionCount: 1,
            parseErrorCount: 0,
          },
        ],
      },
    });

    const reloaded = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });
    expect(reloaded.findByQueryDigest("digest-1")).toMatchObject({
      id: "analysis-1",
      basicStatus: "succeeded",
      sourceSnapshot: {
        sourceDigest: "digest-source",
        collectedAt: 1_234,
        providerStatuses: [
          {
            providerId: "codex",
            status: "supported",
            sessionCount: 1,
            parseErrorCount: 0,
          },
        ],
      },
    });
  });

  it("returns undefined for a missing query digest and overwrites existing records on upsert", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const repo = new WorkAnalysisRepo({ filePath: join(dir, "work-analysis.sqlite") });

    expect(repo.findByQueryDigest("missing-digest")).toBeUndefined();

    repo.upsert({
      id: "analysis-1",
      queryDigest: "digest-1",
      workspacePaths: ["/repo/app"],
      timeRange: { preset: "7d" },
      basicStatus: "running",
      deepStatus: "idle",
    });

    repo.upsert({
      id: "analysis-2",
      queryDigest: "digest-1",
      workspacePaths: ["/repo/app", "/repo/lib"],
      timeRange: { preset: "30d" },
      basicStatus: "succeeded",
      deepStatus: "failed",
    });

    expect(repo.findByQueryDigest("digest-1")).toMatchObject({
      id: "analysis-2",
      workspacePaths: ["/repo/app", "/repo/lib"],
      basicStatus: "succeeded",
      deepStatus: "failed",
    });
  });

  it("ignores malformed persisted records when loading", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const filePath = join(dir, "work-analysis.sqlite");
    const legacyJsonFilePath = join(dir, "work-analysis.json");

    writeFileSync(
      legacyJsonFilePath,
      JSON.stringify({
        version: 1,
        records: {
          "digest-valid": {
            id: "analysis-valid",
            queryDigest: "digest-valid",
            workspacePaths: ["/repo/app"],
            timeRange: { preset: "7d" },
            basicStatus: "succeeded",
            deepStatus: "idle",
          },
          "digest-invalid": {
            id: 123,
            queryDigest: "digest-invalid",
            workspacePaths: ["/repo/lib"],
            timeRange: { preset: "7d" },
            basicStatus: "succeeded",
            deepStatus: "idle",
          },
        },
      }),
      "utf-8"
    );

    const repo = new WorkAnalysisRepo({ filePath, legacyJsonFilePath });

    expect(repo.findByQueryDigest("digest-valid")).toMatchObject({
      id: "analysis-valid",
      queryDigest: "digest-valid",
    });
    expect(repo.findByQueryDigest("digest-invalid")).toBeUndefined();
  });

  it("ignores persisted records whose outer key disagrees with queryDigest", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-analysis-repo-"));
    const filePath = join(dir, "work-analysis.sqlite");
    const legacyJsonFilePath = join(dir, "work-analysis.json");

    writeFileSync(
      legacyJsonFilePath,
      JSON.stringify({
        version: 1,
        records: {
          "outer-digest": {
            id: "analysis-1",
            queryDigest: "inner-digest",
            workspacePaths: ["/repo/app"],
            timeRange: { preset: "7d" },
            basicStatus: "succeeded",
            deepStatus: "idle",
          },
        },
      }),
      "utf-8"
    );

    const repo = new WorkAnalysisRepo({ filePath, legacyJsonFilePath });

    expect(repo.findByQueryDigest("outer-digest")).toBeUndefined();
    expect(repo.findByQueryDigest("inner-digest")).toBeUndefined();
  });
});
