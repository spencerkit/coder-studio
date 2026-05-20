import { EventEmitter } from "node:events";
import type { ProviderDefinition, Supervisor } from "@coder-studio/core";
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
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [],
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
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: ["codex", "exec", "--json"],
            cwd: process.cwd(),
            env: {},
          })),
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
      activeItemId: undefined,
      progressSummary: undefined,
      itemUpdates: undefined,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "--json"],
      expect.objectContaining({ windowsHide: true, detached: false })
    );
  });
});
