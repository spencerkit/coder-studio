import type { ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { buildProviderRuntimeStatus } from "../../provider-runtime/runtime-status.js";

function createTestProvider(
  id: string,
  strategies: ProviderDefinition["install"]["strategies"]
): ProviderDefinition {
  return {
    id,
    displayName: `${id} provider`,
    badge: id,
    capability: "full",
    install: {
      prerequisites: ["npm"],
      manualGuideKeys: [`provider.install.${id}.manual`],
      docUrls: {
        provider: `https://example.com/${id}`,
        prerequisites: {
          npm: "https://example.com/npm",
        },
      },
      strategies,
    },
    buildCommand: () => ({
      argv: [id],
      env: {},
      cwd: "/tmp",
    }),
    configSchema: z.object({}).passthrough(),
    defaultConfig: {},
    requiredCommands: [id],
  };
}

const codexProvider = createTestProvider("codex", {
  win32: [
    {
      id: "install-npm",
      kind: "prerequisite",
      targetCommand: "npm",
      requiresCommands: ["winget"],
      command: "winget",
      args: ["install", "OpenJS.NodeJS.LTS"],
    },
    {
      id: "install-codex",
      kind: "provider",
      targetCommand: "codex",
      requiresCommands: ["npm"],
      command: "npm",
      args: ["install", "-g", "@openai/codex"],
    },
  ],
});

const claudeProvider = createTestProvider("claude", {
  darwin: [
    {
      id: "install-npm",
      kind: "prerequisite",
      targetCommand: "npm",
      requiresCommands: ["brew"],
      command: "brew",
      args: ["install", "node"],
    },
    {
      id: "install-claude",
      kind: "provider",
      targetCommand: "claude",
      requiresCommands: ["npm"],
      command: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
    },
  ],
});

it("separates missing provider commands from missing prerequisites", async () => {
  const commandExists = vi.fn(async (command: string) => command === "winget");

  const result = await buildProviderRuntimeStatus([codexProvider], {
    platform: "win32",
    commandExists,
  });

  expect(result.providers.codex).toMatchObject({
    available: false,
    missingCommands: ["codex"],
    missingPrerequisites: ["npm"],
    autoInstallSupported: true,
    installReadiness: "missing_prerequisite",
  });
});

it("reports unsupported auto-install when the installer command is missing on macOS", async () => {
  const commandExists = vi.fn(async () => false);

  const result = await buildProviderRuntimeStatus([claudeProvider], {
    platform: "darwin",
    commandExists,
  });

  expect(result.providers.claude).toMatchObject({
    available: false,
    missingCommands: ["claude"],
    missingPrerequisites: ["npm"],
    autoInstallSupported: false,
    installReadiness: "unsupported_platform",
  });
});

it("reports unsupported platform when the provider command is missing and no install strategy exists", async () => {
  const commandExists = vi.fn(async (command: string) => command === "npm");

  const result = await buildProviderRuntimeStatus([codexProvider], {
    platform: "aix",
    commandExists,
  });

  expect(result.providers.codex).toMatchObject({
    available: false,
    missingCommands: ["codex"],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: "unsupported_platform",
  });
});

it("reports runtime entries for expanded built-in providers with provider metadata", async () => {
  const commandExists = vi.fn(async (command: string) =>
    ["claude", "codex", "gemini", "agent"].includes(command)
  );

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: "linux",
    commandExists,
  });

  expect(result.providers.gemini).toMatchObject({
    providerId: "gemini",
    displayName: "Gemini CLI",
    kind: "built_in",
    stability: "stable",
    supportsAgentInstructionsGeneration: true,
    available: true,
    missingCommands: [],
  });
  expect(result.providers.cursor).toMatchObject({
    providerId: "cursor",
    displayName: "Cursor Agent",
    kind: "built_in",
    stability: "stable",
    supportsAgentInstructionsGeneration: true,
    available: true,
    missingCommands: [],
  });
  expect(result.providers.claude).toMatchObject({
    providerId: "claude",
    displayName: "Claude Code",
    kind: "built_in",
    supportsAgentInstructionsGeneration: true,
    available: true,
    missingCommands: [],
  });
  expect(result.providers.codex).toMatchObject({
    providerId: "codex",
    supportsAgentInstructionsGeneration: true,
    available: true,
  });
  expect(result.providers.opencode).toMatchObject({
    providerId: "opencode",
    displayName: "OpenCode",
    kind: "built_in",
    stability: "experimental",
    supportsAgentInstructionsGeneration: false,
    available: false,
    missingCommands: ["opencode"],
    autoInstallSupported: false,
  });
});

it("reports Gemini as ready for npm-backed auto-install on Linux", async () => {
  const commandExists = vi.fn(async (command: string) => command === "npm");

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: "linux",
    commandExists,
  });

  expect(result.providers.gemini).toMatchObject({
    available: false,
    missingCommands: ["gemini"],
    missingPrerequisites: [],
    autoInstallSupported: true,
    installReadiness: "ready",
    manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.gemini.manual"],
    docUrls: {
      provider: "https://google-gemini.github.io/gemini-cli/docs/get-started/",
      prerequisites: {
        npm: "https://nodejs.org/en/download",
      },
    },
  });
});

it("reports OpenCode as ready for npm-backed auto-install on Linux", async () => {
  const commandExists = vi.fn(async (command: string) => command === "npm");

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: "linux",
    commandExists,
  });

  expect(result.providers.opencode).toMatchObject({
    available: false,
    missingCommands: ["opencode"],
    missingPrerequisites: [],
    autoInstallSupported: true,
    installReadiness: "ready",
    manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.opencode.manual"],
    docUrls: {
      provider: "https://github.com/anomalyco/opencode#installation",
      prerequisites: {
        npm: "https://nodejs.org/en/download",
      },
    },
  });
});

it("reports Cursor Agent as ready for script-backed auto-install on Linux", async () => {
  const commandExists = vi.fn(async (command: string) => command === "bash");

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: "linux",
    commandExists,
  });

  expect(result.providers.cursor).toMatchObject({
    available: false,
    requiredCommands: ["agent"],
    missingCommands: ["agent"],
    missingPrerequisites: [],
    autoInstallSupported: true,
    installReadiness: "ready",
    manualGuideKeys: ["provider.install.cursor.manual"],
    docUrls: {
      provider: "https://cursor.com/docs/cli/installation",
      prerequisites: {},
    },
  });
});

it("reports Cursor Agent as ready for script-backed auto-install on macOS", async () => {
  const commandExists = vi.fn(async (command: string) => command === "bash");

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: "darwin",
    commandExists,
  });

  expect(result.providers.cursor).toMatchObject({
    available: false,
    requiredCommands: ["agent"],
    missingCommands: ["agent"],
    missingPrerequisites: [],
    autoInstallSupported: true,
    installReadiness: "ready",
    manualGuideKeys: ["provider.install.cursor.manual"],
    docUrls: {
      provider: "https://cursor.com/docs/cli/installation",
      prerequisites: {},
    },
  });
});

it("keeps Cursor Agent manual-only on native Windows", async () => {
  const commandExists = vi.fn(async () => false);

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: "win32",
    commandExists,
  });

  expect(result.providers.cursor).toMatchObject({
    available: false,
    requiredCommands: ["agent"],
    missingCommands: ["agent"],
    autoInstallSupported: false,
    installReadiness: "unsupported_platform",
    manualGuideKeys: ["provider.install.cursor.manual"],
  });
});
