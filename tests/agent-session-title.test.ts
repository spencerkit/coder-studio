import test from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "../apps/web/src/i18n";
import { previewAgentSessionTitle } from "../apps/web/src/features/agents/agent-runtime-actions";
import type { Tab } from "../apps/web/src/state/workbench";

const makeTab = (title: string, isDraft = true): Tab => ({
  id: "ws-1",
  title: "Workspace",
  status: "ready",
  controller: {
    role: "controller",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 1,
    takeoverPending: false,
    takeoverRequestedBySelf: false,
  },
  project: {
    kind: "local",
    path: "/tmp/ws-1",
    target: { type: "native" },
  },
  agent: {
    provider: "claude",
    command: "claude",
    useWsl: false,
  },
  git: { branch: "main", changes: 0, lastCommit: "HEAD" },
  gitChanges: [],
  worktrees: [],
  sessions: [{
    id: "session-1",
    title,
    status: "idle",
    mode: "branch",
    autoFeed: true,
    isDraft,
    queue: [],
    messages: [],
    unread: 0,
    lastActiveAt: 0,
  }],
  activeSessionId: "session-1",
  archive: [],
  terminals: [],
  activeTerminalId: "",
  fileTree: [],
  changesTree: [],
  filePreview: {
    path: "",
    content: "",
    mode: "preview",
    diff: "",
    originalContent: "",
    modifiedContent: "",
    dirty: false,
  },
  paneLayout: {
    type: "leaf",
    id: "pane-1",
    sessionId: "session-1",
  },
  activePaneId: "pane-1",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true,
  },
});

test("previewAgentSessionTitle applies the first prompt to a draft session immediately", () => {
  const t = createTranslator("en");
  let tab = makeTab(t("draftSessionTitle"));

  const applied = previewAgentSessionTitle({
    tabId: tab.id,
    sessionId: "session-1",
    rawInput: "title derived from first prompt",
    locale: "en",
    t,
    updateTab: (_tabId, updater) => {
      tab = updater(tab);
    },
  });

  assert.equal(applied, "title derived from first prompt");
  assert.equal(tab.sessions[0]?.title, "title derived from first prompt");
});

test("previewAgentSessionTitle does not overwrite a user-renamed session", () => {
  const t = createTranslator("en");
  let tab = makeTab("Custom Session", false);

  const applied = previewAgentSessionTitle({
    tabId: tab.id,
    sessionId: "session-1",
    rawInput: "title derived from first prompt",
    locale: "en",
    t,
    updateTab: (_tabId, updater) => {
      tab = updater(tab);
    },
  });

  assert.equal(applied, null);
  assert.equal(tab.sessions[0]?.title, "Custom Session");
});
