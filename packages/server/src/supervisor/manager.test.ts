import type { ProviderDefinition } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorManager } from "./manager.js";

type MockSupervisorManagerDeps = {
  eventBus: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  broadcaster: { broadcast: ReturnType<typeof vi.fn> };
  terminalMgr: { write: ReturnType<typeof vi.fn> };
  workspaceMgr: { get: ReturnType<typeof vi.fn> };
  sessionMgr: {
    get: ReturnType<typeof vi.fn>;
    getLatestSubmittedUserInput: ReturnType<typeof vi.fn>;
    getRenderedSnapshot: ReturnType<typeof vi.fn>;
    sendInput: ReturnType<typeof vi.fn>;
  };
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: { get: ReturnType<typeof vi.fn> };
  settingsRepo: { get: ReturnType<typeof vi.fn> };
  supervisorRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    getBySessionId: ReturnType<typeof vi.fn>;
    listAll: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  targetStore: {
    cloneTargetFiles: ReturnType<typeof vi.fn>;
    deleteTarget: ReturnType<typeof vi.fn>;
    listRecoverableTargets: ReturnType<typeof vi.fn>;
    createTargetFiles: ReturnType<typeof vi.fn>;
    resetTargetFiles: ReturnType<typeof vi.fn>;
    readTargetMeta: ReturnType<typeof vi.fn>;
    loadTargetMemory: ReturnType<typeof vi.fn>;
    saveTargetMeta: ReturnType<typeof vi.fn>;
    saveTargetMemory: ReturnType<typeof vi.fn>;
    appendTargetCycleRecord: ReturnType<typeof vi.fn>;
    markTargetSuperseded: ReturnType<typeof vi.fn>;
    readTargetCycleRecords: ReturnType<typeof vi.fn>;
  };
};

const cycleRecords = new Map<string, Record<string, unknown>[]>();

function createProvider(): ProviderDefinition {
  return {
    id: "claude",
    displayName: "Claude",
    badge: "Claude",
    kind: "built_in",
    capability: "full",
    capabilities: [
      { key: "interactive_session", supported: true, label: "Interactive session" },
      { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
    ],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: {
        provider: "https://example.test/provider",
        prerequisites: {},
      },
      strategies: {},
    },
    buildCommand: () => ({
      argv: ["node", "-e", 'process.stdout.write("noop")'],
      cwd: process.cwd(),
      env: {},
    }),
    configSchema: { parse: (value: unknown) => value } as ProviderDefinition["configSchema"],
    defaultConfig: {},
    requiredCommands: [],
    headless: {
      supportedScenarios: ["supervisor_eval"],
      buildCommand: vi.fn(() => ({
        argv: [
          "node",
          "-e",
          `process.stdout.write(${JSON.stringify(
            JSON.stringify({
              mode: "evaluate",
              status: "continue",
              reason: "Need more work",
              guidance: "continue with the work",
            })
          )})`,
        ],
        cwd: process.cwd(),
        env: {},
      })),
    },
  } as unknown as ProviderDefinition;
}

function createFailingProvider(message = "Evaluator exploded"): ProviderDefinition {
  return {
    ...createProvider(),
    headless: {
      supportedScenarios: ["supervisor_eval"],
      buildCommand: vi.fn(() => {
        throw new Error(message);
      }),
    },
  } as unknown as ProviderDefinition;
}

function createSequenceProvider(payloads: unknown[]): ProviderDefinition {
  let index = 0;
  return {
    ...createProvider(),
    headless: {
      supportedScenarios: ["supervisor_eval"],
      buildCommand: vi.fn(() => {
        const payload = payloads[Math.min(index, payloads.length - 1)];
        index += 1;
        return {
          argv: ["node", "-e", `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`],
          cwd: process.cwd(),
          env: {},
        };
      }),
    },
  } as unknown as ProviderDefinition;
}

function injectedText(deps: MockSupervisorManagerDeps): string {
  const input = deps.sessionMgr.sendInput.mock.calls.at(-1)?.[1];
  return Buffer.isBuffer(input) ? input.toString("utf8") : "";
}

describe("SupervisorManager", () => {
  let deps: MockSupervisorManagerDeps;

  beforeEach(() => {
    const supervisors = new Map<string, Record<string, unknown>>();
    cycleRecords.clear();
    deps = {
      eventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
      broadcaster: { broadcast: vi.fn() },
      terminalMgr: { write: vi.fn() },
      workspaceMgr: { get: vi.fn(() => ({ id: "ws-1", path: "/workspace" })) },
      sessionMgr: {
        get: vi.fn(() => ({
          id: "sess-1",
          terminalId: "term-1",
          workspaceId: "ws-1",
          providerId: "claude",
          state: "running",
          capability: "full",
          startedAt: 1,
          lastActiveAt: 1,
        })),
        getLatestSubmittedUserInput: vi.fn(() => "continue the target"),
        getRenderedSnapshot: vi.fn(async () => "latest terminal snapshot"),
        sendInput: vi.fn(),
      },
      providerRegistry: [createProvider()],
      providerConfigRepo: {
        get: vi.fn(() => ({
          model: "claude-sonnet-4-6",
          additionalArgs: [],
          envVars: {},
        })),
      },
      settingsRepo: {
        get: vi.fn(() => undefined),
      },
      supervisorRepo: {
        create: vi.fn((value) => {
          const next = {
            ...value,
            targetId: value.id,
            recentTargetCycles: [],
          };
          supervisors.set(value.id, next);
          return next;
        }),
        update: vi.fn((id, patch) => {
          const current = supervisors.get(id);
          if (!current) {
            throw new Error(`Supervisor not found: ${id}`);
          }
          const next = {
            ...current,
            ...(patch.state !== undefined ? { state: patch.state } : {}),
            ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
            ...(patch.evaluatorProviderId !== undefined
              ? { evaluatorProviderId: patch.evaluatorProviderId }
              : {}),
            ...(patch.evaluatorModel !== undefined
              ? { evaluatorModel: patch.evaluatorModel ?? undefined }
              : {}),
            ...(patch.maxSupervisionCount !== undefined
              ? { maxSupervisionCount: patch.maxSupervisionCount }
              : {}),
            ...(patch.completedSupervisionCount !== undefined
              ? { completedSupervisionCount: patch.completedSupervisionCount }
              : {}),
            ...(patch.scheduledAt !== undefined
              ? { scheduledAt: patch.scheduledAt ?? undefined }
              : {}),
            ...(patch.stopReason !== undefined
              ? { stopReason: patch.stopReason ?? undefined }
              : {}),
            ...(patch.lastCycleAt !== undefined
              ? { lastCycleAt: patch.lastCycleAt ?? undefined }
              : {}),
            ...(patch.lastEvaluatedTurnId !== undefined
              ? { lastEvaluatedTurnId: patch.lastEvaluatedTurnId ?? undefined }
              : {}),
            ...(patch.errorReason !== undefined
              ? { errorReason: patch.errorReason ?? undefined }
              : {}),
            ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
          };
          supervisors.set(id, next);
          return next;
        }),
        findById: vi.fn((id) => supervisors.get(id)),
        getBySessionId: vi.fn((sessionId) =>
          [...supervisors.values()].find((value) => value.sessionId === sessionId)
        ),
        listAll: vi.fn(() => [...supervisors.values()]),
        delete: vi.fn((id) => {
          supervisors.delete(id);
        }),
      },
      targetStore: {
        cloneTargetFiles: vi.fn(async () => 0),
        deleteTarget: vi.fn(async () => {}),
        listRecoverableTargets: vi.fn(async () => []),
        createTargetFiles: vi.fn(async () => {}),
        resetTargetFiles: vi.fn(async () => {}),
        readTargetMeta: vi.fn(async () => ({
          targetId: "tgt-1",
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Persist supervisors",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          supersededBy: null,
          completedAt: null,
          supervisor: undefined,
        })),
        loadTargetMemory: vi.fn(async () => ({
          schemaVersion: 2,
          targetId: "tgt-1",
          planTree: {
            id: "root",
            title: "Supervisor target",
            objective: "Complete the supervised target",
            deliverable: "Completed target",
            acceptanceCriteria: ["Target objective is complete"],
            status: "in_progress",
            taskType: "generic",
            children: [
              {
                id: "stage-1",
                title: "Verify the fix",
                objective: "Confirm the fix works",
                deliverable: "A passing focused verification run",
                acceptanceCriteria: ["Focused verification passes"],
                status: "in_progress",
                taskType: "generic",
                children: [],
              },
            ],
          },
          activeNodeId: "stage-1",
          maxDepth: 6,
          planRevision: 0,
          progressSummary: "Verification in progress",
          lastGuidance: "continue with the work",
          stalledCount: 0,
          updatedAt: 1,
        })),
        saveTargetMeta: vi.fn(async () => {}),
        saveTargetMemory: vi.fn(async () => {}),
        appendTargetCycleRecord: vi.fn(async (_workspacePath, targetId, record) => {
          const existing = cycleRecords.get(targetId) ?? [];
          existing.push({ ...record, targetId });
          cycleRecords.set(targetId, existing);
        }),
        markTargetSuperseded: vi.fn(async () => {}),
        readTargetCycleRecords: vi.fn(async (_workspacePath, targetId, limit = 20) => {
          const existing = cycleRecords.get(targetId) ?? [];
          return existing.slice(-limit).reverse();
        }),
      },
    };
  });

  it("starts runtime listeners without hydrating persisted supervisors", () => {
    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );

    manager.start();

    expect(deps.eventBus.on).toHaveBeenCalledWith("session.lifecycle", expect.any(Function));
  });

  it("hydrate only starts runtime listeners and does not auto-load supervisors", async () => {
    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    await manager.hydrate();

    expect(manager.get("sup-1")).toBeUndefined();
    expect(deps.eventBus.on).toHaveBeenCalledWith("session.lifecycle", expect.any(Function));
  });

  it("drops workspace supervisors from memory during workspace teardown", async () => {
    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    await manager.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Persist supervisors",
      evaluatorProviderId: "claude",
    });
    vi.mocked(deps.workspaceMgr.get).mockImplementation((workspaceId: string) =>
      workspaceId === "ws-1" ? { id: "ws-1", path: "/workspace" } : { id: "ws-2", path: "/ws-2" }
    );
    vi.mocked(deps.sessionMgr.get).mockImplementation((sessionId: string) => ({
      id: sessionId,
      terminalId: `term-${sessionId}`,
      workspaceId: sessionId === "sess-2" ? "ws-2" : "ws-1",
      providerId: "claude",
      state: "running",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    }));
    await manager.create({
      sessionId: "sess-2",
      workspaceId: "ws-2",
      objective: "Leave this one alone",
      evaluatorProviderId: "claude",
    });

    await manager.deleteForWorkspace("ws-1");

    expect(manager.getBySession("sess-1")).toBeUndefined();
    expect(manager.getBySession("sess-2")).toBeDefined();
  });

  it("keeps current target state attached when an evaluation fails", async () => {
    deps.providerRegistry = [createFailingProvider()];

    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    const supervisor = await manager.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Persist supervisors",
      evaluatorProviderId: "claude",
    });
    cycleRecords.set(supervisor.targetId, [
      {
        cycleId: "target-cycle-0",
        targetId: supervisor.targetId,
        startedAt: 1,
        completedAt: 2,
        result: "continue",
        reason: "Need one more implementation step",
      },
    ]);

    await expect(manager.runEvaluation(supervisor.id, "turn_completed")).rejects.toThrow(
      "Evaluator exploded"
    );

    const failed = manager.get(supervisor.id);
    expect(failed?.state).toBe("error");
    expect(failed?.currentTargetMemory?.targetId).toBe("tgt-1");
    expect(failed?.currentTargetMemory?.progressSummary).toBe("Verification in progress");
    expect(failed?.recentTargetCycles?.[0]?.errorReason).toBe("Evaluator exploded");
    expect(
      failed?.recentTargetCycles?.some(
        (cycle) => cycle.reason === "Need one more implementation step"
      )
    ).toBe(true);
  });

  it("recursively decomposes only the active branch before injecting executable guidance", async () => {
    deps.providerRegistry = [
      createSequenceProvider([
        {
          mode: "decompose",
          children: [
            {
              id: "volume-1",
              title: "Volume 1",
              objective: "Draft the first volume",
              deliverable: "A full first volume",
              acceptanceCriteria: ["Volume 1 has a complete arc"],
              status: "in_progress",
              taskType: "writing",
              children: [],
            },
            {
              id: "volume-2",
              title: "Volume 2",
              objective: "Draft the second volume",
              deliverable: "A full second volume",
              acceptanceCriteria: ["Volume 2 has a complete arc"],
              status: "pending",
              taskType: "writing",
              children: [],
            },
          ],
          activeNodeId: "volume-1",
        },
        {
          mode: "ready_check",
          nodeId: "volume-1",
          taskType: "writing",
          granularity: "too_large",
          reason: "A full volume is too broad",
        },
        {
          mode: "decompose_child",
          parentNodeId: "volume-1",
          children: [
            {
              id: "scene-card-1",
              title: "Create first scene card",
              objective: "Prepare the first scene",
              deliverable: "A 500-800 word scene card",
              acceptanceCriteria: ["Conflict is explicit"],
              taskType: "writing",
              status: "in_progress",
            },
          ],
          activeNodeId: "scene-card-1",
        },
        {
          mode: "ready_check",
          nodeId: "scene-card-1",
          taskType: "writing",
          granularity: "ready",
          reason: "A scene card is an executable writing task",
        },
        {
          mode: "executable_task",
          nodeId: "scene-card-1",
          guidance: "Create a 500-800 word scene card for the first scene.",
        },
        {
          mode: "evaluate",
          status: "continue",
          reason: "The scene card still needs to be written",
          guidance: "Create a 500-800 word scene card for the first scene.",
        },
      ]),
    ];
    deps.targetStore.loadTargetMemory.mockResolvedValue({
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "root",
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
    });

    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    const supervisor = await manager.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Write a 1M word novel",
      evaluatorProviderId: "claude",
    });

    await manager.runEvaluation(supervisor.id, "turn_completed");

    const savedMemory = deps.targetStore.saveTargetMemory.mock.calls.at(-1)?.[2];
    expect(savedMemory?.planTree?.children[0]?.children[0]?.id).toBe("scene-card-1");
    expect(savedMemory?.planTree?.children[1]?.children).toEqual([]);
    expect(savedMemory?.activeNodeId).toBe("scene-card-1");
    expect(injectedText(deps)).toContain("Create a 500-800 word scene card");
  });

  it("uses fallback executable guidance when maxDepth is reached and node is still too large", async () => {
    deps.providerRegistry = [
      createSequenceProvider([
        {
          mode: "ready_check",
          nodeId: "scene-1",
          taskType: "writing",
          granularity: "too_large",
          reason: "The scene still lacks enough structure",
        },
        {
          mode: "executable_task",
          nodeId: "scene-1",
          guidance: "Create a scene card before drafting the full scene.",
          fallback: true,
        },
        {
          mode: "evaluate",
          status: "continue",
          reason: "The scene card still needs to be created",
          guidance: "Create a scene card before drafting the full scene.",
        },
      ]),
    ];
    deps.targetStore.loadTargetMemory.mockResolvedValue({
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "root",
        title: "Novel",
        objective: "Write the novel",
        deliverable: "Novel",
        acceptanceCriteria: ["Novel is complete"],
        status: "in_progress",
        taskType: "writing",
        children: [
          {
            id: "scene-1",
            title: "Scene 1",
            objective: "Draft scene 1",
            deliverable: "Scene 1 draft",
            acceptanceCriteria: ["Scene 1 is coherent"],
            status: "in_progress",
            taskType: "writing",
            children: [],
          },
        ],
      },
      activeNodeId: "scene-1",
      maxDepth: 1,
      planRevision: 1,
      stalledCount: 0,
      updatedAt: 1,
    });

    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    const supervisor = await manager.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Write a 1M word novel",
      evaluatorProviderId: "claude",
    });

    await manager.runEvaluation(supervisor.id, "turn_completed");

    expect(injectedText(deps)).toContain("Create a scene card before drafting");
  });

  it("advances the active plan leaf when evaluation marks it done", async () => {
    deps.providerRegistry = [
      createSequenceProvider([
        {
          mode: "ready_check",
          nodeId: "scene-1",
          taskType: "writing",
          granularity: "ready",
          reason: "Scene 1 is bounded",
        },
        {
          mode: "executable_task",
          nodeId: "scene-1",
          guidance: "Draft scene 1 with a clear conflict and outcome.",
        },
        {
          mode: "evaluate",
          status: "continue",
          reason: "Scene 1 is complete, continue to scene 2",
          guidance: "Draft scene 2 with the same constraints.",
          nodeUpdates: [{ id: "scene-1", status: "done" }],
        },
      ]),
    ];
    deps.targetStore.loadTargetMemory.mockResolvedValue({
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "root",
        title: "Novel",
        objective: "Write the novel",
        deliverable: "Novel",
        acceptanceCriteria: ["Novel is complete"],
        status: "in_progress",
        taskType: "writing",
        children: [
          {
            id: "scene-1",
            title: "Scene 1",
            objective: "Draft scene 1",
            deliverable: "Scene 1 draft",
            acceptanceCriteria: ["Scene 1 is coherent"],
            status: "in_progress",
            taskType: "writing",
            children: [],
          },
          {
            id: "scene-2",
            title: "Scene 2",
            objective: "Draft scene 2",
            deliverable: "Scene 2 draft",
            acceptanceCriteria: ["Scene 2 is coherent"],
            status: "pending",
            taskType: "writing",
            children: [],
          },
        ],
      },
      activeNodeId: "scene-1",
      maxDepth: 6,
      planRevision: 1,
      stalledCount: 0,
      updatedAt: 1,
    });

    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    const supervisor = await manager.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Write a 1M word novel",
      evaluatorProviderId: "claude",
    });

    await manager.runEvaluation(supervisor.id, "turn_completed");

    const savedMemory = deps.targetStore.saveTargetMemory.mock.calls.at(-1)?.[2];
    expect(savedMemory?.planTree?.children[0]?.status).toBe("done");
    expect(savedMemory?.planTree?.children[1]?.status).toBe("in_progress");
    expect(savedMemory?.activeNodeId).toBe("scene-2");
  });
});
