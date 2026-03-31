import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_PROVIDER_MANIFESTS,
  getProviderBadgeLabel,
  getProviderManifest,
  getProviderPanelId,
} from "../apps/web/src/features/providers/registry.ts";

test("registry exposes builtin providers in fixed manifest order", () => {
  assert.deepEqual(
    BUILTIN_PROVIDER_MANIFESTS.map((manifest) => manifest.id),
    ["claude", "codex"],
  );
});

test("getProviderPanelId returns stable provider panel ids", () => {
  assert.equal(getProviderPanelId("claude"), "provider:claude");
  assert.equal(getProviderPanelId("codex"), "provider:codex");
});

test("getProviderBadgeLabel returns builtin badge labels and unknown fallback", () => {
  assert.equal(getProviderBadgeLabel("claude"), "Claude");
  assert.equal(getProviderBadgeLabel("codex"), "Codex");
  assert.equal(getProviderBadgeLabel("mock"), "Unknown (mock)");
  assert.equal(getProviderBadgeLabel("unknown-provider"), "Unknown (unknown-provider)");
});

test("getProviderBadgeLabel falls back for unknown providers", () => {
  assert.equal(getProviderBadgeLabel("unknown-provider"), "Unknown (unknown-provider)");
});

test("builtin manifests carry startup behavior and runtime validation metadata", () => {
  for (const providerId of ["claude", "codex"] as const) {
    const manifest = getProviderManifest(providerId);

    assert.ok(manifest);
    assert.ok(manifest?.startupBehavior);
    assert.ok(manifest?.runtimeValidation);
    assert.ok(Array.isArray(manifest?.runtimeValidation.commandFieldPath));
    assert.equal(typeof manifest?.runtimeValidation.commandLabelKey, "string");
    assert.equal(typeof manifest?.runtimeValidation.commandHintKey, "string");
    assert.ok(Array.isArray(manifest?.runtimeValidation.requiredCommands));

    for (const requirement of manifest?.runtimeValidation.requiredCommands ?? []) {
      assert.equal(typeof requirement.id, "string");
      assert.equal(typeof requirement.command, "string");
      assert.equal(typeof requirement.labelKey, "string");
      assert.equal(typeof requirement.hintKey, "string");
    }
  }
});

test("builtin manifests use standardized startup behavior and dependency validation", () => {
  const claude = getProviderManifest("claude");
  const codex = getProviderManifest("codex");

  assert.equal(claude?.startupBehavior.firstSubmitStrategy, "immediate_newline");
  assert.equal(codex?.startupBehavior.firstSubmitStrategy, "flush_then_newline");

  assert.deepEqual(claude?.runtimeValidation.commandFieldPath, ["executable"]);
  assert.deepEqual(codex?.runtimeValidation.commandFieldPath, ["executable"]);

  assert.equal(claude?.label, "Claude Code");
  assert.equal(claude?.badgeLabel, "Claude");
  assert.equal(claude?.startupBehavior.startupQuietMs, 400);
  assert.equal(claude?.startupBehavior.startupDiscoveryMs, 1200);
  assert.equal(claude?.runtimeValidation.deferredHintKey, "runtimeCheckClaudeDeferredHint");

  assert.equal(codex?.label, "Codex");
  assert.equal(codex?.badgeLabel, "Codex");
  assert.equal(codex?.startupBehavior.startupQuietMs, 1200);
  assert.equal(codex?.startupBehavior.startupDiscoveryMs, 3000);
  assert.equal(codex?.runtimeValidation.deferredHintKey, "runtimeCheckCodexDeferredHint");

  const gitRequirement = [
    {
      id: "git",
      command: "git",
      labelKey: "runtimeCheckGitLabel",
      hintKey: "runtimeCheckGitHint",
    },
  ];

  assert.deepEqual(claude?.runtimeValidation.requiredCommands, gitRequirement);
  assert.deepEqual(codex?.runtimeValidation.requiredCommands, gitRequirement);
});

test("manifest field paths and kinds are provider-global contract values", () => {
  const claude = getProviderManifest("claude");
  const codex = getProviderManifest("codex");

  assert.deepEqual(claude?.settingsSections[0]?.fields[0]?.path, ["startupArgs"]);
  assert.equal(claude?.settingsSections[0]?.fields[0]?.kind, "string_list");
  assert.equal(
    claude?.settingsSections.some((section) => (
      section.fields.some((field) => field.id === "permission-mode")
    )),
    false,
  );
  assert.deepEqual(claude?.settingsSections[1]?.fields[0]?.path, ["env", "ANTHROPIC_API_KEY"]);
  assert.equal(claude?.settingsSections[1]?.fields[0]?.kind, "text");

  assert.deepEqual(codex?.settingsSections[0]?.fields[0]?.path, ["executable"]);
  assert.equal(codex?.settingsSections[0]?.fields[0]?.kind, "command");
  assert.deepEqual(codex?.settingsSections[0]?.fields[1]?.path, ["extraArgs"]);
  assert.equal(codex?.settingsSections[0]?.fields[1]?.kind, "string_list");
  assert.equal(
    codex?.settingsSections.some((section) => (
      section.fields.some((field) => field.path.join(".") === "modelReasoningEffort" && field.kind === "select")
    )),
    true,
  );
  assert.equal(
    codex?.settingsSections.some((section) => (
      section.fields.some((field) => field.path.join(".") === "env" && field.kind === "env_map")
    )),
    true,
  );
});

test("removed mock provider is no longer exposed as a builtin manifest", () => {
  assert.equal(getProviderManifest("mock"), undefined);
});
