import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_PROVIDER_MANIFESTS,
  getProviderBadgeLabel,
  getProviderManifest,
  getProviderPanelId,
} from "../apps/web/src/features/providers/registry";

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

test("builtin manifests do not leak startup behavior or other runtime metadata", () => {
  for (const providerId of ["claude", "codex"] as const) {
    const manifest = getProviderManifest(providerId);

    assert.ok(manifest);
    assert.equal("startupBehavior" in (manifest ?? {}), false);
    assert.equal("capabilities" in (manifest ?? {}), false);
    assert.equal("runtimeValidation" in (manifest ?? {}), false);
    assert.equal("settingsDefaults" in (manifest ?? {}), false);
  }
});

test("builtin manifests keep stable identity labels without startup behavior config", () => {
  const claude = getProviderManifest("claude");
  const codex = getProviderManifest("codex");

  assert.equal(claude?.label, "Claude Code");
  assert.equal(claude?.badgeLabel, "Claude");

  assert.equal(codex?.label, "Codex");
  assert.equal(codex?.badgeLabel, "Codex");
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
  assert.deepEqual(claude?.settingsSections[1]?.fields[0]?.path, ["env", "ANTHROPIC_AUTH_TOKEN"]);
  assert.equal(claude?.settingsSections[1]?.fields[0]?.kind, "text");

  assert.deepEqual(codex?.settingsSections[0]?.fields[0]?.path, ["executable"]);
  assert.equal(codex?.settingsSections[0]?.fields[0]?.kind, "command");
  assert.deepEqual(codex?.settingsSections[0]?.fields[1]?.path, ["extraArgs"]);
  assert.equal(codex?.settingsSections[0]?.fields[1]?.kind, "string_list");
  assert.equal(
    codex?.settingsSections.some((section) => (
      section.fields.some((field) => field.path.join(".") === "apiKey" && field.kind === "text")
    )),
    true,
  );
  assert.equal(
    codex?.settingsSections.some((section) => (
      section.fields.some((field) => field.path.join(".") === "baseUrl" && field.kind === "text")
    )),
    true,
  );
  assert.equal(
    codex?.settingsSections.some((section) => (
      section.fields.some((field) => field.path.join(".") === "modelReasoningEffort")
    )),
    false,
  );
});

test("removed mock provider is no longer exposed as a builtin manifest", () => {
  assert.equal(getProviderManifest("mock"), undefined);
});
