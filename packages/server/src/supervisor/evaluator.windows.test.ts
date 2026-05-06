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
    state: "idle",
    objective: "obj",
    evaluatorProviderId: "codex",
    cycles: [],
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
  };
}

describe("SupervisorEvaluator windows child-process options", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes windowsHide to spawn", async () => {
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
              item: { id: "i1", type: "agent_message", text: "Run pnpm vitest to verify" },
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
      message: "Run pnpm vitest to verify",
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "--json"],
      expect.objectContaining({ windowsHide: true })
    );
  });
});
