import type { Supervisor, SupervisorCycle } from "@coder-studio/core";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWriterAtom, serverInfoAtom, sessionsAtom } from "../atoms";
import {
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { paneLayoutAtomFamily } from "../features/agent-panes/atoms/pane-layout";
import { supervisorCyclesAtom, supervisorsAtom } from "../features/supervisor/atoms";
import { terminalMetaAtomFamily } from "../features/terminal-panel/atoms";
import { fileTreeStaleAtomFamily } from "../features/workspace/atoms";
import { resetAppProvidersSingletonsForTests, routeEventToAtom } from "./providers";

describe("routeEventToAtom", () => {
  const createSupervisor = (): Supervisor => ({
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle",
    objective: "Track progress",
    evaluatorProviderId: "claude",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    recentTargetCycles: [],
    cycles: [],
    createdAt: 1,
    updatedAt: 1,
  });

  const createCycle = (): SupervisorCycle => ({
    id: "cycle-1",
    supervisorId: "sup-1",
    sessionId: "sess-1",
    status: "completed",
    trigger: "manual",
    evidenceSource: "transcript",
    objective: "Track progress",
    evaluatorProviderId: "claude",
    createdAt: 1,
    completedAt: 2,
  });

  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
  });

  it("removes supervisor state and cycles on delete events", () => {
    const store = createStore();
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map([["sup-1", [createCycle()]]]));

    routeEventToAtom(
      "workspace.ws-1.session.sess-1.supervisor.state",
      { supervisorId: "sup-1", event: "deleted" },
      store
    );

    expect(store.get(supervisorsAtom).size).toBe(0);
    expect(store.get(supervisorCyclesAtom).size).toBe(0);
  });

  it("stores server metadata from the initial connected status event", () => {
    const store = createStore();

    routeEventToAtom(
      "connection.status",
      {
        status: "connected",
        authEnabled: false,
        version: "0.3.0",
        serverInstanceId: "server-123",
        isWriter: true,
      },
      store
    );

    expect(store.get(serverInfoAtom)).toEqual({
      version: "0.3.0",
      serverInstanceId: "server-123",
      authEnabled: false,
    });
    expect(store.get(isWriterAtom)).toBe(true);
  });

  it("appends brand-new workspace meta events to workspace order without reordering existing entries", () => {
    const store = createStore();

    routeEventToAtom("workspace.ws-1.meta", { path: "/tmp/ws-1", targetRuntime: "native" }, store);
    routeEventToAtom("workspace.ws-2.meta", { path: "/tmp/ws-2", targetRuntime: "native" }, store);

    expect(store.get(workspaceOrderAtom)).toEqual(["ws-1", "ws-2"]);

    routeEventToAtom("workspace.ws-1.meta", { name: "Renamed workspace" }, store);
    routeEventToAtom("workspace.ws-2.meta", { name: "Also renamed" }, store);

    expect(store.get(workspaceOrderAtom)).toEqual(["ws-1", "ws-2"]);
  });

  it("marks workspace load state ready and clears the load error for a valid brand-new workspace meta event", () => {
    const store = createStore();
    store.set(workspacesLoadStateAtom, "loading");
    store.set(workspacesLoadErrorAtom, "load failed");

    routeEventToAtom("workspace.ws-1.meta", { path: "/tmp/ws-1", targetRuntime: "native" }, store);

    expect(store.get(workspacesLoadStateAtom)).toBe("ready");
    expect(store.get(workspacesLoadErrorAtom)).toBeNull();
  });

  it("resolves the active workspace after a valid brand-new workspace meta event when the intent points at that id", () => {
    const store = createStore();
    store.set(activeWorkspaceIdAtom, "ws-1");

    routeEventToAtom("workspace.ws-1.meta", { path: "/tmp/ws-1", targetRuntime: "native" }, store);

    expect(store.get(activeWorkspaceAtom)?.id).toBe("ws-1");
  });

  it("projects workspace pane layout updates into the pane layout atom", () => {
    const store = createStore();

    routeEventToAtom(
      "workspace.ws-1.meta",
      {
        path: "/tmp/ws-1",
        targetRuntime: "native",
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          paneLayout: {
            id: "root",
            type: "leaf",
            sessionId: "sess-1",
          },
        },
      },
      store
    );

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "leaf",
      sessionId: "sess-1",
    });
  });

  it("marks the file tree stale when an fs.dirty event arrives", () => {
    const store = createStore();

    routeEventToAtom("workspace.ws-1.fs.dirty", { reason: "fs_change" }, store);

    expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(true);
  });

  it("ignores git metadata-only fs.dirty events for the file tree stale flag", () => {
    const store = createStore();

    routeEventToAtom("workspace.ws-1.fs.dirty", { reason: "git_metadata" }, store);

    expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(false);
  });

  it("marks terminal metadata exited on terminal exit events", () => {
    const store = createStore();
    store.set(terminalMetaAtomFamily("term-1"), {
      id: "term-1",
      workspaceId: "ws-1",
      kind: "agent",
      alive: true,
      title: "Claude",
    });

    routeEventToAtom("workspace.ws-1.terminal.term-1.exit", { code: 1 }, store);

    expect(store.get(terminalMetaAtomFamily("term-1"))).toMatchObject({
      alive: false,
      exitCode: 1,
    });
  });

  it("removes local session artifacts on session removed lifecycle events", () => {
    const store = createStore();
    store.set(sessionsAtom, {
      "sess-1": {
        id: "sess-1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "claude",
        state: "ended",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
        endedAt: 2,
      },
    });
    store.set(terminalMetaAtomFamily("term-1"), {
      id: "term-1",
      workspaceId: "ws-1",
      kind: "agent",
      alive: false,
      exitCode: 1,
      title: "Claude",
    });

    routeEventToAtom("workspace.ws-1.session.sess-1.lifecycle", { event: "removed" }, store);

    expect(store.get(sessionsAtom)).toEqual({});
    expect(store.get(terminalMetaAtomFamily("term-1"))).toBeNull();
  });
});
