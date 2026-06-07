import type { ProviderDefinition } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { buildSessionAnalysisPrompt } from "../session-analysis/prompt.js";
import { SessionAnalysisRunner } from "../session-analysis/runner.js";
import { sessionAnalysisResultSchema } from "../session-analysis/schema.js";
import type { SessionAnalysisResult } from "../session-analysis/types.js";

describe("session analysis prompt", () => {
  it("builds a prompt that requires JSON-only output and lists the result fields", () => {
    const prompt = buildSessionAnalysisPrompt({
      transcript: "user: investigate flaky test\nassistant: narrowed it to prompt formatting",
      context: {
        sessionId: "sess-1",
        workspaceId: "ws-1",
        workspacePath: "/repo/coder-studio",
        providerId: "codex",
        sessionState: "idle",
        sessionTitle: "fix flaky test",
        startedAt: 100,
        lastActiveAt: 200,
        gitStatus: " M packages/server/src/session-analysis/prompt.ts",
        changedFiles: ["packages/server/src/session-analysis/prompt.ts"],
        diffSummary: "1 file changed, 3 insertions(+)",
        latestUserInput: "investigate flaky test",
      },
    });

    expect(prompt).toContain("Return JSON only.");
    expect(prompt).toContain("No prose before or after the JSON.");
    expect(prompt).toContain('"summary": string');
    expect(prompt).toContain('"recentWork": string[]');
    expect(prompt).toContain('"repeatedTopics"');
    expect(prompt).toContain('"bottlenecks"');
    expect(prompt).toContain('"skillCandidates"');
    expect(prompt).toContain('"openLoops": string[]');
    expect(prompt).toContain('"wrapUpSuggestions": string[]');
    expect(prompt).toContain('"confidence": "low" | "medium" | "high"');
    expect(prompt).toContain("Transcript:");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("investigate flaky test");
    expect(prompt).toContain('"workspacePath": "/repo/coder-studio"');
    expect(prompt).toContain('"changedFiles"');
  });
});

describe("sessionAnalysisResultSchema", () => {
  it("accepts results that match SessionAnalysisResult", () => {
    const result = {
      summary: "The session converged after narrowing scope.",
      recentWork: ["Reviewed failing test", "Outlined prompt contract"],
      repeatedTopics: [
        {
          topic: "Prompt formatting",
          whyItRepeated: "The task requires an explicit JSON-only contract.",
          evidence: ["The prompt must list required fields"],
        },
      ],
      bottlenecks: [
        {
          title: "Missing prompt helper",
          impact: "Task 2 cannot wire the runner contract yet.",
          evidence: ["prompt.ts does not exist"],
          suggestion: "Add a dedicated prompt builder with a fixed schema section.",
        },
      ],
      skillCandidates: [
        {
          title: "TDD enforcement",
          why: "The task explicitly requires test-first implementation.",
          suggestedScope:
            "Keep the session-analysis contract stable while later tasks add the runner.",
          evidence: ["The plan calls for a failing test before implementation"],
        },
      ],
      openLoops: ["Runner integration is deferred to a later task."],
      wrapUpSuggestions: ["Keep the prompt and schema exports isolated from runner logic."],
      confidence: "medium",
    } satisfies SessionAnalysisResult;

    expect(sessionAnalysisResultSchema.parse(result)).toEqual(result);
  });

  it("rejects results with an invalid confidence value", () => {
    const parse = () =>
      sessionAnalysisResultSchema.parse({
        summary: "Invalid confidence should fail validation.",
        recentWork: [],
        repeatedTopics: [],
        bottlenecks: [],
        skillCandidates: [],
        openLoops: [],
        wrapUpSuggestions: [],
        confidence: "certain",
      });

    expect(parse).toThrow();
  });
});

describe("SessionAnalysisRunner", () => {
  const provider = {
    id: "codex",
    displayName: "Codex",
    badge: "Codex",
    kind: "built_in",
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/workspace" }),
    configSchema: { parse: (value: unknown) => value } as ProviderDefinition["configSchema"],
    defaultConfig: {},
    requiredCommands: ["codex"],
    headless: {
      supportedScenarios: ["session_analysis"],
      buildCommand: () => ({
        argv: ["codex", "exec"],
        cwd: "/workspace",
        env: {},
      }),
    },
  } satisfies ProviderDefinition;

  it("parses a plain JSON response", async () => {
    const runner = new SessionAnalysisRunner({
      providerRegistry: [provider],
      commandRunner: async () => ({
        stdout: JSON.stringify({
          summary: "done",
          recentWork: [],
          repeatedTopics: [],
          bottlenecks: [],
          skillCandidates: [],
          openLoops: [],
          wrapUpSuggestions: [],
          confidence: "high",
        }),
        stderr: "",
      }),
    });

    await expect(
      runner.run({
        providerId: "codex",
        sessionId: "sess-1",
        workspacePath: "/workspace",
        transcript: "user: hi",
        context: {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          workspacePath: "/workspace",
          providerId: "codex",
          sessionState: "ended",
          startedAt: 1,
          lastActiveAt: 2,
          changedFiles: [],
        },
      })
    ).resolves.toMatchObject({
      summary: "done",
      confidence: "high",
    });
  });

  it("parses Codex JSONL output by extracting the completed agent message", async () => {
    const runner = new SessionAnalysisRunner({
      providerRegistry: [provider],
      commandRunner: async () => ({
        stdout: [
          '{"type":"item.started","item":{"type":"agent_message"}}',
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                summary: "done",
                recentWork: [],
                repeatedTopics: [],
                bottlenecks: [],
                skillCandidates: [],
                openLoops: [],
                wrapUpSuggestions: [],
                confidence: "medium",
              }),
            },
          }),
        ].join("\n"),
        stderr: "",
      }),
    });

    await expect(
      runner.run({
        providerId: "codex",
        sessionId: "sess-1",
        workspacePath: "/workspace",
        transcript: "user: hi",
        context: {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          workspacePath: "/workspace",
          providerId: "codex",
          sessionState: "ended",
          startedAt: 1,
          lastActiveAt: 2,
          changedFiles: [],
        },
      })
    ).resolves.toMatchObject({
      summary: "done",
      confidence: "medium",
    });
  });
});
