import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAppSettingsToTabs,
  summarizeWorkbenchSettingsSync,
} from "../apps/web/src/features/app/workbench-settings-sync.ts";
import type { Tab } from "../apps/web/src/state/workbench-core.ts";
import type { AppSettings } from "../apps/web/src/types/app.ts";

const appSettings: AppSettings = {
  agentProvider: "claude",
  agentCommand: "claude --print",
  idlePolicy: {
    enabled: true,
    idleMinutes: 15,
    maxActive: 5,
    pressure: false,
  },
  completionNotifications: {
    enabled: true,
    onlyWhenBackground: true,
  },
  terminalCompatibilityMode: "standard",
};

const createTab = (
  id: string,
  overrides?: Partial<Pick<Tab, "agent" | "idlePolicy">>,
): Tab => ({
  id,
  title: id,
  status: "ready",
  controller: {
    role: "controller",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 1,
    takeoverPending: false,
    takeoverRequestedBySelf: false,
  },
  agent: {
    provider: "claude",
    command: "claude --print",
    useWsl: false,
    ...(overrides?.agent ?? {}),
  },
  git: { branch: "main", changes: 0, lastCommit: "abc123" },
  gitChanges: [],
  worktrees: [],
  sessions: [],
  activeSessionId: "",
  archive: [],
  terminals: [],
  activeTerminalId: "",
  fileTree: [],
  changesTree: [],
  filePreview: {
    path: "",
    content: "",
    mode: "preview",
    originalContent: "",
    modifiedContent: "",
    dirty: false,
  },
  paneLayout: {
    type: "leaf",
    id: "pane-1",
    sessionId: "",
  },
  activePaneId: "pane-1",
  idlePolicy: {
    enabled: true,
    idleMinutes: 15,
    maxActive: 5,
    pressure: false,
    ...(overrides?.idlePolicy ?? {}),
  },
});

test("summarizeWorkbenchSettingsSync checks all workspaces instead of only the first", () => {
  const tabs = [
    createTab("ws-1"),
    createTab("ws-2", {
      agent: { provider: "claude", command: "claude", useWsl: false },
      idlePolicy: {
        enabled: true,
        idleMinutes: 10,
        maxActive: 3,
        pressure: true,
      },
    }),
  ];

  const summary = summarizeWorkbenchSettingsSync(tabs, appSettings);

  assert.deepEqual(summary.agentWorkspaceIds, ["ws-2"]);
  assert.deepEqual(summary.idlePolicyWorkspaceIds, ["ws-2"]);
});

test("applyAppSettingsToTabs updates stale workspaces and leaves matching ones untouched", () => {
  const matching = createTab("ws-1");
  const stale = createTab("ws-2", {
    agent: { provider: "claude", command: "claude", useWsl: false },
    idlePolicy: {
      enabled: true,
      idleMinutes: 10,
      maxActive: 3,
      pressure: true,
    },
  });

  const [nextMatching, nextStale] = applyAppSettingsToTabs([matching, stale], appSettings);

  assert.equal(nextMatching, matching);
  assert.equal(nextStale.agent.command, "claude --print");
  assert.deepEqual(nextStale.idlePolicy, appSettings.idlePolicy);
});
