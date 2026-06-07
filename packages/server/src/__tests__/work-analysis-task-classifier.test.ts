import { describe, expect, it } from "vitest";

import { classifyTaskTurn } from "../work-analysis/classification/task-classifier.js";
import { deriveTaskTurns } from "../work-analysis/classification/task-turn-builder.js";
import type { WorkLogEvent, WorkLogSession } from "../work-analysis/log-sources/types.js";

function createSession(events: WorkLogEvent[]): WorkLogSession {
  return {
    providerId: "codex",
    sessionId: "sess-1",
    workspacePath: "/repo",
    startedAt: 100,
    lastActiveAt: 400,
    sourceRef: "/tmp/session.jsonl",
    userTurnCount: events.filter((event) => event.eventType === "message" && event.role === "user")
      .length,
    assistantTurnCount: events.filter(
      (event) => event.eventType === "message" && event.role === "assistant"
    ).length,
    toolUseCount: events.filter((event) => event.eventType === "tool").length,
    parseErrorCount: 0,
    timestampQuality: "explicit",
    events,
  };
}

function createEvent(
  index: number,
  overrides: Partial<WorkLogEvent> & Pick<WorkLogEvent, "eventType" | "canonicalEventType">
): WorkLogEvent {
  return {
    eventId: `event-${index}`,
    providerId: "codex",
    sessionId: "sess-1",
    workspacePath: "/repo",
    eventType: overrides.eventType,
    canonicalEventType: overrides.canonicalEventType,
    occurredAt: index * 100,
    rawRefs: [],
    ...overrides,
  };
}

describe("classifyTaskTurn", () => {
  it("classifies a bash-only test turn as testing", () => {
    const result = classifyTaskTurn({
      userMessage: "run vitest and verify the failing spec",
      toolNames: ["Bash"],
      commandTexts: ["pnpm vitest src/foo.test.ts"],
      filePaths: [],
      hasEdits: false,
      hasReads: false,
      hasPlanMode: false,
      hasAgentSpawn: false,
      hasSearch: false,
      hasMcpTool: false,
      hasTaskTool: false,
      hasSkillTool: false,
    });

    expect(result.primaryTask).toBe("testing");
  });

  it("classifies an edit turn as feature development with debugging as secondary", () => {
    const result = classifyTaskTurn({
      userMessage: "add error handling to the fetch helper",
      toolNames: ["Edit"],
      commandTexts: [],
      filePaths: ["src/fetch.ts"],
      toolSteps: [{ tool: "Edit", file: "src/fetch.ts" }],
      hasEdits: true,
      hasReads: false,
      hasPlanMode: false,
      hasAgentSpawn: false,
      hasSearch: false,
      hasMcpTool: false,
      hasTaskTool: false,
      hasSkillTool: false,
    });

    expect(result.primaryTask).toBe("feature_dev");
    expect(result.secondaryTasks).toContain("debugging");
  });

  it("counts retries from ordered tool steps within a turn", () => {
    const result = classifyTaskTurn({
      userMessage: "fix the failing test",
      toolNames: ["Edit", "Bash", "Edit"],
      commandTexts: ["pnpm test src/foo.test.ts"],
      filePaths: ["src/foo.ts", "src/foo.ts"],
      toolSteps: [
        { tool: "Edit", file: "src/foo.ts" },
        { tool: "Bash", command: "pnpm test src/foo.test.ts" },
        { tool: "Edit", file: "src/foo.ts" },
      ],
      hasEdits: true,
      hasReads: false,
      hasPlanMode: false,
      hasAgentSpawn: false,
      hasSearch: false,
      hasMcpTool: false,
      hasTaskTool: false,
      hasSkillTool: false,
    });

    expect(result.primaryTask).toBe("debugging");
    expect(result.retries).toBe(1);
  });
});

describe("deriveTaskTurns", () => {
  it("starts turns on user messages when the session contains any user input", () => {
    const turns = deriveTaskTurns(
      createSession([
        createEvent(1, {
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Read",
          filePath: "src/prelude.ts",
        }),
        createEvent(2, {
          eventType: "message",
          canonicalEventType: "message_turn",
          role: "user",
          text: "run the test suite",
        }),
        createEvent(3, {
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Bash",
          commandText: "pnpm vitest src/foo.test.ts",
        }),
      ])
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turnId: "sess-1:turn:0",
      userMessage: "run the test suite",
      toolNames: ["Bash"],
      commandTexts: ["pnpm vitest src/foo.test.ts"],
      filePaths: [],
      toolSteps: [{ tool: "Bash", command: "pnpm vitest src/foo.test.ts" }],
      startedAt: 200,
    });
  });

  it("synthesizes a single turn when the session has no user messages", () => {
    const turns = deriveTaskTurns(
      createSession([
        createEvent(1, {
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Read",
          filePath: "src/only-tool.ts",
        }),
        createEvent(2, {
          eventType: "command",
          canonicalEventType: "command",
          commandText: "pnpm vitest src/foo.test.ts",
        }),
      ])
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turnId: "sess-1:turn:0",
      userMessage: "",
      toolNames: ["Read"],
      commandTexts: ["pnpm vitest src/foo.test.ts"],
      filePaths: ["src/only-tool.ts"],
      toolSteps: [
        { tool: "Read", file: "src/only-tool.ts" },
        { tool: "command", command: "pnpm vitest src/foo.test.ts" },
      ],
      startedAt: 100,
    });
  });
});
