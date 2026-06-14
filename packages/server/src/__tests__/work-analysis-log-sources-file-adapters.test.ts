import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createClaudeWorkLogSource } from "../work-analysis/log-sources/claude.js";
import { createCodexWorkLogSource } from "../work-analysis/log-sources/codex.js";
import { createCursorWorkLogSource } from "../work-analysis/log-sources/cursor.js";
import { createGeminiWorkLogSource } from "../work-analysis/log-sources/gemini.js";

async function makeHome() {
  return await mkdtemp(join(tmpdir(), "work-log-home-"));
}

describe("file provider work log sources", () => {
  it("reads Codex sessions by metadata cwd and time range", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "session.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            cwd: "/repo/app",
            model_provider: "openai",
            git: { branch: "main", commit_hash: "abc123" },
          },
        }),
        JSON.stringify({ type: "user_message", payload: { text: "fix tests" } }),
        JSON.stringify({ type: "agent_message", payload: { text: "done" } }),
        JSON.stringify({ type: "tool_call", payload: { name: "shell" } }),
        JSON.stringify({
          timestamp: "2026-06-03T01:10:00.000Z",
          type: "event_msg",
          event: "token_count",
          payload: {
            input_tokens: 120,
            cached_input_tokens: 40,
            output_tokens: 55,
            reasoning_output_tokens: 12,
            total_tokens: 227,
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      providerId: "codex",
      sessionId: "codex-session-1",
      workspacePath: "/repo/app",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
      gitBranch: "main",
      gitCommit: "abc123",
      usage: {
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 55,
        reasoningOutputTokens: 12,
        totalTokens: 227,
      },
      usageCoverage: {
        hasUsage: true,
        callCount: 1,
        callsWithTotalTokens: 1,
        estimatedCallCount: 0,
      },
    });
    expect(result.sessions[0]?.usageCalls).toHaveLength(1);
  });

  it("reads Codex token_count events from payload.type records used by current local logs", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "session-payload-type.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-payload-type",
            cwd: "/repo/app",
            model: "gpt-5-codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:10:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 120,
                cached_input_tokens: 40,
                output_tokens: 55,
                reasoning_output_tokens: 12,
                total_tokens: 175,
              },
              last_token_usage: {
                input_tokens: 120,
                cached_input_tokens: 40,
                output_tokens: 55,
                reasoning_output_tokens: 12,
                total_tokens: 175,
              },
            },
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId: "codex-session-payload-type",
      usage: {
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 55,
        reasoningOutputTokens: 12,
        totalTokens: 175,
      },
    });
  });

  it("limits Codex partial status and parse errors to matched metadata files", async () => {
    const home = await makeHome();
    const matchedDir = join(home, ".codex/sessions/2026/06/03");
    const unmatchedDir = join(home, ".codex/sessions/2026/06/04");
    mkdirSync(matchedDir, { recursive: true });
    mkdirSync(unmatchedDir, { recursive: true });

    writeFileSync(
      join(matchedDir, "matched.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "matched-session", cwd: "/repo/app" },
        }),
        "{bad json",
        JSON.stringify({ type: "user_message", payload: { text: "fix tests" } }),
      ].join("\n")
    );
    writeFileSync(
      join(unmatchedDir, "unmatched.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-04T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "unmatched-session", cwd: "/repo/other" },
        }),
        "{also bad json",
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-05T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("partial");
    expect(result.parseErrorCount).toBe(2);
    expect(result.warnings).toHaveLength(2);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((session) => session.workspacePath)).toEqual([
      "/repo/app",
      "/repo/other",
    ]);
  });

  it("uses the first valid Codex JSON line as metadata for workspace attribution", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "session.jsonl"),
      [
        "{bad json",
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "wrong-session", cwd: "/repo/other" },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:05:00.000Z",
          type: "session_meta",
          payload: { id: "later-session", cwd: "/repo/app" },
        }),
        JSON.stringify({
          type: "user_message",
          payload: { text: "should not match later metadata" },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("partial");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId: "wrong-session",
      workspacePath: "/repo/other",
      userTurnCount: 1,
      parseErrorCount: 1,
    });
    expect(result.parseErrorCount).toBe(1);
  });

  it("returns partial for matched Codex files with parse errors even when they are out of range", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "out-of-range.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "old-session", cwd: "/repo/app" },
        }),
        "{bad json",
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-04T00:00:00.000Z"),
        endAt: Date.parse("2026-06-05T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("partial");
    expect(result.sessions).toHaveLength(0);
    expect(result.parseErrorCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("reads Claude sessions from encoded workspace project logs", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-session-1",
          cwd: "/repo/app",
          gitBranch: "feature",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-session-1",
          cwd: "/repo/app",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            usage: {
              input_tokens: 300,
              output_tokens: 120,
              cache_creation_input_tokens: 90,
              cache_read_input_tokens: 60,
            },
            content: [{ type: "thinking" }, { type: "text" }],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "claude",
      sessionId: "claude-session-1",
      workspacePath: "/repo/app",
      userTurnCount: 1,
      assistantTurnCount: 1,
      gitBranch: "feature",
      modelId: "claude-sonnet-4-5",
      usage: {
        inputTokens: 300,
        outputTokens: 120,
        cacheCreationInputTokens: 90,
        cacheReadInputTokens: 60,
        reasoningOutputTokens: 0,
        totalTokens: 570,
      },
      usageCoverage: {
        hasUsage: true,
        callCount: 1,
        callsWithTotalTokens: 1,
        estimatedCallCount: 0,
      },
    });
    expect(result.sessions[0]?.usageCalls).toHaveLength(1);
  });

  it("sums Claude assistant usage calls within a session", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-session-sum",
          cwd: "/repo/app",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-session-sum",
          cwd: "/repo/app",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            usage: {
              input_tokens: 300,
              output_tokens: 120,
              cache_creation_input_tokens: 90,
              cache_read_input_tokens: 60,
            },
            content: [{ type: "thinking" }, { type: "text", text: "first" }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:10:00.000Z",
          sessionId: "claude-session-sum",
          cwd: "/repo/app",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            usage: {
              input_tokens: 20,
              output_tokens: 10,
              cache_creation_input_tokens: 5,
              cache_read_input_tokens: 15,
            },
            content: [{ type: "text", text: "second" }],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "claude-session-sum",
      usage: {
        inputTokens: 320,
        outputTokens: 130,
        cacheCreationInputTokens: 95,
        cacheReadInputTokens: 75,
        reasoningOutputTokens: 0,
        totalTokens: 620,
      },
      usageCoverage: {
        hasUsage: true,
        callCount: 2,
        callsWithTotalTokens: 2,
        estimatedCallCount: 0,
      },
    });
    expect(result.sessions[0]?.usageCalls?.map((call) => call.usage.totalTokens)).toEqual([
      570, 50,
    ]);
  });

  it("extracts skill names from Claude Skill tool_use parts", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude-skill.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-skill-session",
          cwd: "/repo/app",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-skill-session",
          cwd: "/repo/app",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
              {
                type: "tool_use",
                name: "Skill",
                input: {
                  skill: "superpowers:systematic-debugging",
                },
              },
            ],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Skill",
          toolCategory: "skill",
          skillName: "superpowers:systematic-debugging",
          payload: { input: { skill: "superpowers:systematic-debugging" } },
        }),
      ])
    );
  });

  it("reads Claude Skill tool_use parts from nested subagent logs", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app/subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "agent-skill.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-subagent-skill-session",
          cwd: "/repo/app",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
              {
                type: "tool_use",
                name: "Skill",
                input: {
                  skill: "superpowers:subagent-driven-development",
                },
              },
            ],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Skill",
          toolCategory: "skill",
          skillName: "superpowers:subagent-driven-development",
        }),
      ])
    );
  });

  it("normalizes Claude tool blocks into command and edit/read events with file paths", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude-tools.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-tool-events",
          cwd: "/repo/app",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-tool-events",
          cwd: "/repo/app",
          toolUse: {
            name: "shell",
            command: "pnpm test src/app.test.ts",
          },
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
              {
                type: "tool_use",
                name: "Read",
                input: { file_path: "src/app.ts" },
              },
              {
                type: "tool_use",
                name: "Edit",
                input: {
                  file_path: "src/app.ts",
                  old_string: "before",
                  new_string: "after",
                },
              },
              { type: "text", text: "updated app.ts" },
            ],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "claude-tool-events",
      toolUseCount: 3,
    });
    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "command",
          canonicalEventType: "command",
          toolName: "Bash",
          toolCategory: "bash",
          commandText: "pnpm test src/app.test.ts",
        }),
        expect.objectContaining({
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Read",
          toolCategory: "read",
          filePath: "src/app.ts",
        }),
        expect.objectContaining({
          eventType: "edit",
          canonicalEventType: "edit",
          toolName: "Edit",
          toolCategory: "edit",
          filePath: "src/app.ts",
        }),
      ])
    );
  });

  it("normalizes Claude task and search tool blocks to exact classifier-facing names", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude-task-search.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-task-search",
          cwd: "/repo/app",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-task-search",
          cwd: "/repo/app",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
              {
                type: "tool_use",
                name: "TodoWrite",
                input: { items: [{ content: "verify task names" }] },
              },
              {
                type: "tool_use",
                name: "WebSearch",
                input: { query: "vitest docs" },
              },
            ],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "claude-task-search",
      toolUseCount: 2,
    });
    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "plan",
          canonicalEventType: "plan",
          toolName: "TodoWrite",
          toolCategory: "task",
        }),
        expect.objectContaining({
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "WebSearch",
          toolCategory: "search",
        }),
      ])
    );
  });

  it("ignores Claude attachments that are not actual tool calls", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude-attachments.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-attachments",
          cwd: "/repo/app",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-attachments",
          cwd: "/repo/app",
          attachment: {
            command: "session-start-hook",
            note: "not a tool call",
          },
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text: "no tool use happened" }],
          },
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "claude-attachments",
      toolUseCount: 0,
    });
    expect(result.sessions[0]?.events?.filter((event) => event.role === "tool")).toEqual([]);
  });

  it("derives Codex session usage from token_count deltas when cumulative totals are reported", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "delta-session.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-delta-1",
            cwd: "/repo/app",
            model: "gpt-5-codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:10:00.000Z",
          type: "event_msg",
          event: "token_count",
          payload: {
            info: {
              last_token_usage: {
                input_tokens: 120,
                cached_input_tokens: 40,
                output_tokens: 55,
                reasoning_output_tokens: 12,
                total_tokens: 227,
              },
              total_token_usage: {
                input_tokens: 120,
                cached_input_tokens: 40,
                output_tokens: 55,
                reasoning_output_tokens: 12,
                total_tokens: 227,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:20:00.000Z",
          type: "event_msg",
          event: "token_count",
          payload: {
            info: {
              total_token_usage: {
                input_tokens: 150,
                cached_input_tokens: 50,
                output_tokens: 65,
                reasoning_output_tokens: 15,
                total_tokens: 280,
              },
            },
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "codex-delta-1",
      usage: {
        inputTokens: 150,
        cachedInputTokens: 50,
        outputTokens: 65,
        reasoningOutputTokens: 15,
        totalTokens: 280,
      },
      usageCoverage: {
        hasUsage: true,
        callCount: 2,
        callsWithTotalTokens: 2,
        estimatedCallCount: 0,
      },
    });
    expect(result.sessions[0]?.usageCalls?.map((call) => call.usage.totalTokens)).toEqual([
      227, 53,
    ]);
  });

  it("normalizes Codex parsed commands and custom tool calls into richer turn signals", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tool-events.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-tool-events",
            cwd: "/repo/app",
            model: "gpt-5-codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:01:00.000Z",
          type: "tool_call",
          payload: {
            name: "shell",
            text: "pnpm test src/app.test.ts",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            parsed_cmd: [
              {
                type: "read",
                cmd: "cat src/app.ts",
                name: "app.ts",
                path: "src/app.ts",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:03:00.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            input: [
              "*** Begin Patch",
              "*** Update File: src/app.ts",
              "@@",
              "-before",
              "+after",
              "*** End Patch",
            ].join("\n"),
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "codex-tool-events",
      toolUseCount: 3,
    });
    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "command",
          canonicalEventType: "command",
          toolName: "Bash",
          toolCategory: "bash",
          commandText: "pnpm test src/app.test.ts",
        }),
        expect.objectContaining({
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Read",
          toolCategory: "read",
          filePath: "src/app.ts",
          commandText: "cat src/app.ts",
        }),
        expect.objectContaining({
          eventType: "edit",
          canonicalEventType: "edit",
          toolName: "Edit",
          toolCategory: "edit",
          filePath: "src/app.ts",
        }),
      ])
    );
  });

  it("extracts skill names from Codex Skill tool payloads", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "skill-events.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-skill-events",
            cwd: "/repo/app",
            model: "gpt-5-codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:01:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "Skill",
            input: {
              skill: "frontend-design",
            },
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "tool",
          canonicalEventType: "tool_call",
          toolName: "Skill",
          toolCategory: "skill",
          skillName: "frontend-design",
          payload: { input: { skill: "frontend-design" } },
        }),
      ])
    );
  });

  it("normalizes Codex exec_command function calls without double-counting parsed command echoes", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "exec-command-events.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-exec-command-events",
            cwd: "/repo/app",
            model: "gpt-5-codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:01:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "pnpm test src/app.test.ts",
            }),
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:01:01.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            parsed_cmd: [
              {
                type: "exec_command",
                cmd: "pnpm test src/app.test.ts",
              },
            ],
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "codex-exec-command-events",
      toolUseCount: 1,
    });
    expect(
      result.sessions[0]?.events?.filter(
        (event) =>
          event.eventType === "command" && event.commandText === "pnpm test src/app.test.ts"
      )
    ).toEqual([
      expect.objectContaining({
        eventType: "command",
        canonicalEventType: "command",
        toolName: "Bash",
        toolCategory: "bash",
        commandText: "pnpm test src/app.test.ts",
      }),
    ]);
  });

  it("extracts file paths from Codex edit_file payload inputs", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "edit-file-events.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-edit-file-events",
            cwd: "/repo/app",
            model: "gpt-5-codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-03T01:01:00.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "edit_file",
            input: {
              file_path: "src/app.ts",
              old_string: "before",
              new_string: "after",
            },
          },
        }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "codex-edit-file-events",
      toolUseCount: 1,
    });
    expect(result.sessions[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "edit",
          canonicalEventType: "edit",
          toolName: "Edit",
          toolCategory: "edit",
          filePath: "src/app.ts",
        }),
      ])
    );
  });

  it("reads Gemini chats by .project_root, keeps evidence excerpts, and deduplicates tmp/history", async () => {
    const home = await makeHome();
    const tmpDir = join(home, ".gemini/tmp/app");
    const historyDir = join(home, ".gemini/history/app");
    mkdirSync(join(tmpDir, "chats"), { recursive: true });
    mkdirSync(join(historyDir, "chats"), { recursive: true });
    writeFileSync(join(tmpDir, ".project_root"), "/repo/app");
    writeFileSync(join(historyDir, ".project_root"), "/repo/app");
    const chatJson = JSON.stringify({
      kind: "chat",
      sessionId: "gemini-session-1",
      startTime: "2026-06-03T03:00:00.000Z",
      lastUpdated: "2026-06-03T03:10:00.000Z",
      summary: "Fix tests",
      messages: [
        {
          type: "user",
          timestamp: "2026-06-03T03:00:00.000Z",
          content: [{ text: "fix failing tests" }],
        },
        {
          type: "assistant",
          timestamp: "2026-06-03T03:10:00.000Z",
          content: [{ text: "implemented the fix" }],
        },
      ],
    });
    writeFileSync(join(tmpDir, "chats/session-2026-06-03T01-00-abcd.json"), chatJson);
    writeFileSync(join(historyDir, "chats/session-2026-06-03T01-00-abcd.json"), chatJson);

    const result = await createGeminiWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      providerId: "gemini",
      sessionId: "gemini-session-1",
      title: "Fix tests",
      userTurnCount: 1,
      assistantTurnCount: 1,
    });
    expect(result.sessions[0]?.evidence?.[0]?.excerpts).toMatchObject([
      { role: "user", text: "fix failing tests" },
      { role: "assistant", text: "implemented the fix" },
    ]);
  });

  it("reads Gemini chats whose message content is stored as plain strings", async () => {
    const home = await makeHome();
    const tmpDir = join(home, ".gemini/tmp/string-content");
    mkdirSync(join(tmpDir, "chats"), { recursive: true });
    writeFileSync(join(tmpDir, ".project_root"), "/repo/app");
    writeFileSync(
      join(tmpDir, "chats/session-2026-06-03T02-00-string.json"),
      JSON.stringify({
        kind: "chat",
        sessionId: "gemini-string-content",
        startTime: "2026-06-03T04:00:00.000Z",
        lastUpdated: "2026-06-03T04:05:00.000Z",
        summary: "String content",
        messages: [
          {
            type: "user",
            timestamp: "2026-06-03T04:00:00.000Z",
            content: [{ text: "fix parser" }],
          },
          {
            type: "gemini",
            timestamp: "2026-06-03T04:05:00.000Z",
            content: "handled string content",
          },
        ],
      })
    );

    const result = await createGeminiWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions[0]).toMatchObject({
      providerId: "gemini",
      sessionId: "gemini-string-content",
      userTurnCount: 1,
      assistantTurnCount: 1,
    });
    expect(result.sessions[0]?.evidence?.[0]?.excerpts).toMatchObject([
      { role: "user", text: "fix parser" },
      { role: "assistant", text: "handled string content" },
    ]);
  });

  it("reads Cursor transcripts by encoded workspace with flexible jsonl filenames and reports mtime timestamp quality", async () => {
    const home = await makeHome();
    const dir = join(home, ".cursor/projects/-repo-app/agent-transcripts/cursor-session-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "transcript-42.jsonl"),
      [
        JSON.stringify({
          role: "user",
          message: { content: [{ type: "text", text: "fix" }] },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "tool_call", name: "shell" }] },
        }),
      ].join("\n")
    );

    const result = await createCursorWorkLogSource({ home }).discover({
      timeRange: { startAt: 0, endAt: Date.now() + 60_000, label: "custom" },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "cursor",
      sessionId: "transcript-42",
      workspacePath: "/repo/app",
      timestampQuality: "file_mtime",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
    });
  });

  it("reads Cursor transcripts from WSL-style project directories without cwd in records", async () => {
    const home = await makeHome();
    const dir = join(
      home,
      ".cursor/projects/home-w-workspace-lark-docs/agent-transcripts/cursor-session-1"
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "transcript.jsonl"),
      [
        JSON.stringify({
          role: "user",
          message: { content: [{ type: "text", text: "fix docs" }] },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "tool_use", name: "Read" }] },
        }),
      ].join("\n")
    );

    const result = await createCursorWorkLogSource({ home }).discover({
      workspacePaths: ["/home/w/workspace/lark-docs"],
      timeRange: { startAt: 0, endAt: Date.now() + 60_000, label: "custom" },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "cursor",
      sessionId: "transcript",
      workspacePath: "/home/w/workspace/lark-docs",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
    });
  });

  it("reads Cursor transcripts from Windows-style project directories without cwd in records", async () => {
    const home = await makeHome();
    const dir = join(
      home,
      ".cursor/projects/c-Users-yeshaopeng-workspace-coder-studio/agent-transcripts/cursor-session-1"
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "transcript.jsonl"),
      [
        JSON.stringify({
          role: "user",
          message: { content: [{ type: "text", text: "fix work analysis" }] },
        }),
      ].join("\n")
    );

    const result = await createCursorWorkLogSource({ home }).discover({
      workspacePaths: ["c:\\Users\\yeshaopeng\\workspace\\coder-studio"],
      timeRange: { startAt: 0, endAt: Date.now() + 60_000, label: "custom" },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "cursor",
      sessionId: "transcript",
      workspacePath: "c:\\Users\\yeshaopeng\\workspace\\coder-studio",
      userTurnCount: 1,
    });
  });

  it("prefers cwd from Cursor transcript records when present", async () => {
    const home = await makeHome();
    const dir = join(home, ".cursor/projects/-repo-app/agent-transcripts/cursor-session-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "transcript.jsonl"),
      [
        JSON.stringify({
          role: "user",
          cwd: "/repo/app/feature",
          message: { content: [{ type: "text", text: "fix" }] },
        }),
      ].join("\n")
    );

    const result = await createCursorWorkLogSource({ home }).discover({
      timeRange: { startAt: 0, endAt: Date.now() + 60_000, label: "custom" },
    });

    expect(result.sessions[0]?.workspacePath).toBe("/repo/app/feature");
  });

  it("skips Cursor project directories that cannot be mapped to a workspace path", async () => {
    const home = await makeHome();
    const dir = join(home, ".cursor/projects/empty-window/agent-transcripts/cursor-session-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "transcript.jsonl"),
      [
        JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "fix" }] } }),
      ].join("\n")
    );

    const result = await createCursorWorkLogSource({ home }).discover({
      timeRange: { startAt: 0, endAt: Date.now() + 60_000, label: "custom" },
    });

    expect(result.status).toBe("no_logs");
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });
});
