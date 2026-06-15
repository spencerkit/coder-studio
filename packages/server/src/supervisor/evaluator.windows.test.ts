import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ProviderDefinition, Supervisor } from "@coder-studio/core";
import { WINDOWS_COMMAND_LINE_LIMIT } from "@coder-studio/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { SupervisorEvaluationContext } from "./context-builder.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { SupervisorEvaluator } from "./evaluator.js";

const originalPlatform = process.platform;

function createProviderConfigRepo(): ProviderConfigRepo {
  return {
    get: vi.fn(() => ({ additionalArgs: [], envVars: {} })),
  } as unknown as ProviderConfigRepo;
}

function makeSupervisor(): Supervisor {
  return {
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle",
    objective: "obj",
    evaluatorProviderId: "codex",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    recentTargetCycles: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeContext(): SupervisorEvaluationContext {
  return {
    objective: "obj",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    workspacePath: process.cwd(),
    sessionProviderId: "claude",
    evaluatorProviderId: "codex",
    sessionState: "running",
    evidenceSource: "headless_snapshot",
    terminalExcerpt: "build passes",
    latestUserInput: "run the tests",
    targetMemory: {
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "plan-root",
        title: "Supervisor target",
        objective: "Complete the supervised target",
        deliverable: "Completed target",
        acceptanceCriteria: ["Target objective is complete"],
        status: "pending",
        taskType: "generic",
        children: [],
      },
      activeNodeId: undefined,
      maxDepth: 6,
      planRevision: 0,
      stalledCount: 0,
      updatedAt: 1,
    },
  };
}

describe("SupervisorEvaluator windows child-process options", () => {
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it("passes windowsHide to spawn and disables detached mode on Windows", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    spawnMock.mockImplementation(() => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter() as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
      };

      child.pid = 1234;
      child.stdout = stdout;
      child.stderr = stderr;

      queueMicrotask(() => {
        stdout.emit(
          "data",
          Buffer.from(
            `${JSON.stringify({
              type: "item.completed",
              item: {
                id: "i1",
                type: "agent_message",
                text: JSON.stringify({
                  status: "continue",
                  reason: "Need more work",
                  guidance: "Run pnpm vitest to verify",
                }),
              },
            })}\n${JSON.stringify({ type: "turn.completed", usage: { output_tokens: 20 } })}\n`
          )
        );
        child.emit("exit", 0);
      });

      return child;
    });

    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: "codex",
          headless: {
            supportedScenarios: ["supervisor_eval"],
            buildCommand: vi.fn(() => ({
              argv: ["codex", "exec", "--json"],
              cwd: process.cwd(),
              env: {},
            })),
          },
          defaultConfig: { additionalArgs: [], envVars: {} },
        } as unknown as ProviderDefinition,
      ],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
    });

    await expect(evaluator.evaluate(makeSupervisor(), makeContext())).resolves.toEqual({
      mode: "evaluate",
      status: "continue",
      reason: "Need more work",
      guidance: "Run pnpm vitest to verify",
      activeNodeId: undefined,
      progressSummary: undefined,
      nodeUpdates: undefined,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "--json"],
      expect.objectContaining({ windowsHide: true, detached: false })
    );
  });

  it("delivers an oversized prompt via stdin on Windows instead of argv", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    const longTerminalExcerpt = "x".repeat(WINDOWS_COMMAND_LINE_LIMIT);
    const stdinChunks: Buffer[] = [];
    let capturedStdio: unknown;

    spawnMock.mockImplementation((_file, _args, options) => {
      capturedStdio = options?.stdio;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const stdin = new PassThrough();
      stdin.on("data", (chunk) => {
        stdinChunks.push(Buffer.from(chunk));
      });
      const child = new EventEmitter() as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: PassThrough;
      };

      child.pid = 1234;
      child.stdout = stdout;
      child.stderr = stderr;
      child.stdin = stdin;

      queueMicrotask(() => {
        stdout.emit(
          "data",
          Buffer.from(
            `${JSON.stringify({
              type: "item.completed",
              item: {
                id: "i1",
                type: "agent_message",
                text: JSON.stringify({
                  status: "continue",
                  reason: "Need more work",
                  guidance: "Continue",
                }),
              },
            })}\n`
          )
        );
        child.emit("exit", 0);
      });

      return child;
    });

    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: "codex",
          headless: {
            supportedScenarios: ["supervisor_eval"],
            buildCommand: vi.fn((_config, _scenario, req) => ({
              argv: ["codex", "exec", "--json", req.prompt],
              cwd: process.cwd(),
              env: {},
            })),
          },
          defaultConfig: { additionalArgs: [], envVars: {} },
        } as unknown as ProviderDefinition,
      ],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
    });

    await expect(
      evaluator.evaluate(makeSupervisor(), {
        ...makeContext(),
        terminalExcerpt: longTerminalExcerpt,
      })
    ).resolves.toEqual({
      mode: "evaluate",
      status: "continue",
      reason: "Need more work",
      guidance: "Continue",
      activeItemId: undefined,
      progressSummary: undefined,
      itemUpdates: undefined,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "--json"],
      expect.objectContaining({
        windowsHide: true,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
      })
    );
    expect(capturedStdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(Buffer.concat(stdinChunks).toString("utf8")).toContain("Current terminal snapshot:");
    expect(Buffer.concat(stdinChunks).toString("utf8")).toContain(longTerminalExcerpt);
  });
});
