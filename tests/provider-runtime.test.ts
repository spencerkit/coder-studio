import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  BUILTIN_PROVIDER_MANIFESTS,
  getProviderPanelId,
} from "../apps/web/src/features/providers/registry";
import {
  buildRuntimeRequirementStatusesFromManifest,
} from "../apps/web/src/features/providers/runtime-helpers";

test("settings navigation can derive provider panel ids from builtin manifests", () => {
  const panelIds = BUILTIN_PROVIDER_MANIFESTS.map((manifest) => getProviderPanelId(manifest.id));

  assert.deepEqual(panelIds, [
    "provider:claude",
    "provider:codex",
  ]);
});

test("settings screen source uses manifest-derived provider navigation and generic panel routing", async () => {
  const source = await fs.readFile(
    new URL("../apps/web/src/components/Settings/Settings.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /BUILTIN_PROVIDER_MANIFESTS/);
  assert.match(source, /getProviderPanelId/);
  assert.match(source, /activeSettingsPanel\.startsWith\("provider:"\)/);
  assert.doesNotMatch(source, /activeSettingsPanel === "claude"/);
  assert.doesNotMatch(source, /activeSettingsPanel === "codex"/);
});

test("runtime helpers fall back to generic requirement copy for removed builtin providers", () => {
  assert.deepEqual(
    buildRuntimeRequirementStatusesFromManifest(
      "mock",
      "coder-studio --coder-studio-mock-agent",
      (key) => key,
    ),
    [
      {
        id: "mock",
        label: "Unknown (mock)",
        hint: "providerUnknownHint",
        command: "coder-studio --coder-studio-mock-agent",
        available: null,
        detailText: undefined,
      },
      {
        id: "git",
        label: "runtimeCheckGitLabel",
        hint: "runtimeCheckGitHint",
        command: "git",
        available: null,
        detailText: undefined,
      },
    ],
  );
});

test("runtime helpers provide builtin validation metadata outside the settings manifest", () => {
  assert.deepEqual(
    buildRuntimeRequirementStatusesFromManifest("claude", "claude", (key) => key),
    [
      {
        id: "claude",
        label: "runtimeCheckClaudeLabel",
        hint: "runtimeCheckClaudeHint",
        command: "claude",
        available: null,
        detailText: undefined,
      },
      {
        id: "git",
        label: "runtimeCheckGitLabel",
        hint: "runtimeCheckGitHint",
        command: "git",
        available: null,
        detailText: undefined,
      },
    ],
  );
});

test("runtime helpers include the unknown provider id in fallback hint copy", () => {
  const requirements = buildRuntimeRequirementStatusesFromManifest(
    "custom-agent",
    "custom-agent --serve",
    (key, params) => key === "providerUnknownHint"
      ? `unknown:${String(params?.provider ?? "")}`
      : key,
  );

  assert.equal(requirements[0]?.hint, "unknown:custom-agent");
});

test("runtime validation overlay renders generic requirement labels instead of provider-id branches", async () => {
  const source = await fs.readFile(
    new URL("../apps/web/src/components/RuntimeValidationOverlay/RuntimeValidationOverlay.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /label: string;/);
  assert.match(source, /hint: string;/);
  assert.match(source, /requirement\.label/);
  assert.match(source, /requirement\.hint/);
  assert.doesNotMatch(source, /type RuntimeRequirementId = "claude" \| "codex" \| "git"/);
  assert.doesNotMatch(source, /const requirementCopy =/);
});

test("workspace runtime surfaces use provider registry helpers instead of hardcoded provider labels", async () => {
  const workspaceScreen = await fs.readFile(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );
  const agentWorkspaceFeature = await fs.readFile(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );
  const historyDrawer = await fs.readFile(
    new URL("../apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx", import.meta.url),
    "utf8",
  );
  const agentRuntimeActions = await fs.readFile(
    new URL("../apps/web/src/features/agents/agent-runtime-actions.ts", import.meta.url),
    "utf8",
  );

  assert.match(workspaceScreen, /buildRuntimeRequirementStatusesFromManifest/);
  assert.doesNotMatch(workspaceScreen, /provider: "claude" \| "codex"/);

  assert.match(agentWorkspaceFeature, /BUILTIN_PROVIDER_MANIFESTS/);
  assert.match(agentWorkspaceFeature, /getProviderDisplayLabel/);
  assert.doesNotMatch(agentWorkspaceFeature, /session\.provider === "codex" \? "Codex" : "Claude"/);
  assert.doesNotMatch(agentWorkspaceFeature, /handleSetDraftProvider\("claude"\)/);
  assert.doesNotMatch(agentWorkspaceFeature, /handleSetDraftProvider\("codex"\)/);

  assert.match(historyDrawer, /getProviderDisplayLabel/);
  assert.doesNotMatch(historyDrawer, /record\.provider === "codex" \? "Codex" : "Claude"/);

  assert.doesNotMatch(agentRuntimeActions, /getProviderStartupBehavior/);
  assert.doesNotMatch(agentRuntimeActions, /provider === "codex"/);
  assert.doesNotMatch(agentRuntimeActions, /provider !== "codex"/);
});

test("workspace runtime validation fetches provider command previews through the backend RPC", async () => {
  const workspaceScreen = await fs.readFile(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );
  const systemService = await fs.readFile(
    new URL("../apps/web/src/services/http/system.service.ts", import.meta.url),
    "utf8",
  );

  assert.match(systemService, /"provider_runtime_preview"/);
  assert.match(systemService, /export const getProviderRuntimePreview =/);
  assert.match(workspaceScreen, /getProviderRuntimePreview/);
  assert.match(workspaceScreen, /preview\.display_command/);
  assert.doesNotMatch(workspaceScreen, /resolveDefaultAgentRuntimeCommand/);
});
