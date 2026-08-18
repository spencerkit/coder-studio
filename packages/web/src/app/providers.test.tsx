import type { Supervisor, UpdateStateView } from "@coder-studio/core";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authEnabledAtom,
  isWriterAtom,
  serverInfoAtom,
  sessionsAtom,
  workspacesAtom,
} from "../atoms";
import { authenticatedAtom } from "../atoms/app-ui";
import {
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { paneLayoutAtomFamily } from "../features/agent-panes/atoms/pane-layout";
import { supervisorsAtom } from "../features/supervisor/atoms";
import { terminalMetaAtomFamily } from "../features/terminal-panel/atoms";
import {
  productUpdateStateAtom,
  serverUpdateStateAtom,
  updateControllerAtom,
  updateStateAtom,
} from "../features/updates/atoms";
import {
  activeFilePathAtomFamily,
  fileTreeStaleAtomFamily,
  openEditorPathsAtomFamily,
} from "../features/workspace/atoms";
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
    createdAt: 1,
    updatedAt: 1,
  });

  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
  });

  it("removes supervisor state on delete events", () => {
    const store = createStore();
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

    routeEventToAtom(
      "workspace.ws-1.session.sess-1.supervisor.state",
      { supervisorId: "sup-1", event: "deleted" },
      store
    );

    expect(store.get(supervisorsAtom).size).toBe(0);
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
    expect(store.get(authEnabledAtom)).toBe(false);
    expect(store.get(authenticatedAtom)).toBe(true);
    expect(store.get(isWriterAtom)).toBe(true);
  });

  it("hydrates authEnabled from connection.ready metadata", () => {
    const store = createStore();
    store.set(authEnabledAtom, false);

    routeEventToAtom(
      "connection.ready",
      {
        authEnabled: true,
        version: "0.3.0",
        serverInstanceId: "server-123",
      },
      store
    );

    expect(store.get(authEnabledAtom)).toBe(true);
    expect(store.get(serverInfoAtom)).toEqual({
      version: "0.3.0",
      serverInstanceId: "server-123",
      authEnabled: true,
    });
  });

  it("stores update state from update.state.changed events", () => {
    const store = createStore();

    const state: UpdateStateView = {
      version: 2,
      currentVersion: "0.4.0",
      currentPublishedAt: null,
      latestVersion: "0.5.0",
      latestPublishedAt: null,
      availability: "update_available",
      updateStatus: "idle",
      lastCheckedAt: 123,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
      runtimeContext: {
        environment: "cli-global-npm",
        authority: "cli",
        supported: true,
        unsupportedReason: null,
      },
    };

    routeEventToAtom("update.state.changed", state, store);

    expect(store.get(updateStateAtom)).toEqual(state);
  });

  it("does not let Server events overwrite Desktop product update state", () => {
    const store = createStore();
    const desktopProductState = {
      schemaVersion: 1 as const,
      runtimeContext: {
        environment: "desktop-native" as const,
        authority: "desktop" as const,
        supported: true,
        unsupportedReason: null,
      },
      status: "available" as const,
      productVersion: "0.5.0",
      productPublishedAt: null,
      planId: "desktop-plan",
      createdAt: null,
      updatedAt: null,
      lastCheckedAt: null,
      components: [],
      compatibility: { compatible: true, code: null, summary: null },
      diagnostics: {
        failedComponentId: null,
        failedPhase: null,
        shellVersion: null,
        shellPublishedAt: null,
        shellBuiltAt: null,
        engineVersion: null,
        nodeVersion: null,
        runtimeHostApiVersion: null,
        apiProtocolVersion: null,
        dataSchemaVersion: null,
        logLocations: [],
        recoveryAction: null,
      },
      restartRequired: false,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    };
    const serverState = {
      ...store.get(serverUpdateStateAtom),
      version: 2 as const,
      currentVersion: "0.5.0",
      currentPublishedAt: null,
      latestVersion: "0.6.0",
      latestPublishedAt: null,
      availability: "update_available" as const,
      updateStatus: "idle" as const,
      lastCheckedAt: 123,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: false,
      installKind: "unsupported" as const,
      unsupportedReason: "Managed by Desktop",
      runtimeContext: {
        environment: "desktop-managed" as const,
        authority: "desktop" as const,
        supported: false,
        unsupportedReason: "Managed by Desktop",
      },
    };
    store.set(productUpdateStateAtom, desktopProductState);
    store.set(updateControllerAtom, { kind: "desktop" } as never);

    routeEventToAtom("update.state.changed", serverState, store);

    expect(store.get(serverUpdateStateAtom)).toEqual(serverState);
    expect(store.get(productUpdateStateAtom)).toEqual(desktopProductState);
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
      leafKind: "session",
      sessionId: "sess-1",
    });
  });

  it("preserves typed pane leaf kinds from workspace meta updates", () => {
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
            type: "split",
            direction: "horizontal",
            children: [
              { id: "left", type: "leaf", leafKind: "draft" },
              { id: "right", type: "leaf", leafKind: "editor" },
            ],
          },
        },
      },
      store
    );

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "draft" },
        { id: "right", type: "leaf", leafKind: "editor" },
      ],
    });
  });

  it("projects workspace open editor metadata into editor atoms", () => {
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
          openEditorPaths: ["src/app.tsx", "README.md", "src/app.tsx", ""],
          activeEditorPath: "src/app.tsx",
        },
      },
      store
    );

    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.tsx", "README.md"]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/app.tsx");
  });

  it("keeps local open editor metadata when a workspace meta patch omits editor fields", () => {
    const store = createStore();
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/current.ts"]);
    store.set(activeFilePathAtomFamily("ws-1"), "src/current.ts");

    routeEventToAtom("workspace.ws-1.meta", { path: "/tmp/ws-1", targetRuntime: "native" }, store);
    routeEventToAtom("workspace.ws-1.meta", { name: "Renamed workspace" }, store);

    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/current.ts"]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/current.ts");
  });

  it("preserves editor pinned state when a workspace meta patch only updates part of ui state", () => {
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
          editorPinned: false,
          activeEditorPath: "src/initial.ts",
        },
      },
      store
    );

    routeEventToAtom(
      "workspace.ws-1.meta",
      {
        uiState: {
          activeEditorPath: "src/next.ts",
        },
      },
      store
    );

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/next.ts");
    expect(store.get(workspacesAtom)["ws-1"]?.uiState.editorPinned).toBe(false);
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
