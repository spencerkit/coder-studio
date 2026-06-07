# Richer Agent Instructions Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade generated `.coder-studio/agent.md` from a thin repository summary into a compact project operating guide with architecture map, key directories, stronger commands, and file constraints.

**Architecture:** Expand the structured workspace intelligence summary first, because generation quality is limited by missing input facts today. Then update the agent-generation prompt and the deterministic fallback generator to consume the richer summary while keeping output pure Markdown, compact, and conservative.

**Tech Stack:** TypeScript, Vitest, Node.js filesystem inspection, existing server-side workspace intelligence and agent-instructions generation pipeline

---

## File Map

- Modify: `packages/core/src/domain/types.ts`
  - Extend `WorkspaceIntelligenceSummary` and related command types to carry richer inferred repository facts.
- Modify: `packages/server/src/workspace/intelligence.ts`
  - Add monorepo/package/directory/doc/command/constraint inference.
- Modify: `packages/server/src/agent-instructions/prompt.ts`
  - Change prompt contract to request richer sections and pure Markdown architecture hierarchy.
- Modify: `packages/server/src/agent-instructions/generator.ts`
  - Keep deterministic non-agent generation aligned with the richer section structure.
- Modify: `packages/server/src/__tests__/agent-instructions/generator.test.ts`
  - Update deterministic output expectations.
- Modify: `packages/server/src/__tests__/agent-instructions-command.test.ts`
  - Verify richer prompt-driven generation behavior and summary-derived content.
- Create: `packages/server/src/__tests__/workspace/intelligence.test.ts`
  - Add focused tests for summary inference and prioritization.
- Optional modify if needed by exports only: `packages/core/src/index.ts` or existing export barrel files
  - Only if `WorkspaceIntelligenceSummary` type changes require export updates.

## Task 1: Expand Workspace Intelligence Types

**Files:**
- Modify: `packages/core/src/domain/types.ts`
- Test: `packages/server/src/__tests__/workspace/intelligence.test.ts`

- [ ] **Step 1: Write the failing type-driven workspace intelligence tests**

Create `packages/server/src/__tests__/workspace/intelligence.test.ts` with focused cases for richer inference:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWorkspaceIntelligence } from "../../workspace/intelligence.js";

describe("inspectWorkspaceIntelligence", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        const { rm } = await import("node:fs/promises");
        await rm(dir, { recursive: true, force: true });
      })
    );
  });

  it("infers a monorepo architecture summary with key directories and stronger verification commands", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-"));
    tempDirs.push(rootPath);

    await writeFile(join(rootPath, "pnpm-workspace.yaml"), "packages:\\n  - packages/*\\n");
    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "tsx scripts/dev.ts",
          build: "tsx scripts/build.ts",
          lint: "biome lint .",
          "ci:test": "pnpm -r test",
          "ci:typecheck": "pnpm -r exec tsc -p tsconfig.json --noEmit",
          "ci:verify": "pnpm ci:test && pnpm ci:typecheck",
          "acceptance:phase1": "pnpm --dir e2e exec playwright test --grep @phase1",
        },
      })
    );
    await writeFile(join(rootPath, "README.md"), "# Repo\\n");
    await mkdir(join(rootPath, "docs", "help"), { recursive: true });
    await writeFile(join(rootPath, "docs", "help", "quick-start.md"), "# Quick Start\\n");
    await mkdir(join(rootPath, "packages", "web"), { recursive: true });
    await writeFile(
      join(rootPath, "packages", "web", "package.json"),
      JSON.stringify({ name: "@repo/web", scripts: { test: "vitest run" } })
    );
    await mkdir(join(rootPath, "packages", "server"), { recursive: true });
    await writeFile(
      join(rootPath, "packages", "server", "package.json"),
      JSON.stringify({ name: "@repo/server" })
    );

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-1",
      rootPath,
    });

    expect(summary.workspaceKind).toBe("monorepo");
    expect(summary.keyDirectories.map((entry) => entry.path)).toEqual([
      "packages/web",
      "packages/server",
      "docs",
    ]);
    expect(summary.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "packages/web", role: "frontend_ui" }),
        expect.objectContaining({ path: "packages/server", role: "backend_runtime" }),
      ])
    );
    expect(summary.verificationCommands.map((entry) => entry.command)).toEqual(
      expect.arrayContaining(["pnpm ci:test", "pnpm ci:typecheck", "pnpm ci:verify"])
    );
    expect(summary.fileConstraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("package boundaries"),
        expect.stringContaining("unrelated refactors"),
      ])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/server/src/__tests__/workspace/intelligence.test.ts`

Expected: FAIL because `WorkspaceIntelligenceSummary` and `inspectWorkspaceIntelligence` do not yet expose `workspaceKind`, `keyDirectories`, `packages`, `verificationCommands`, or `fileConstraints`.

- [ ] **Step 3: Extend the shared summary types with richer repository facts**

Update `packages/core/src/domain/types.ts` to add the new summary structures while preserving existing fields:

```ts
export interface WorkspaceIntelligenceKeyDirectory {
  path: string;
  kind:
    | "frontend"
    | "backend"
    | "providers"
    | "shared"
    | "cli"
    | "docs"
    | "tests"
    | "scripts"
    | "other";
  reason: string;
}

export interface WorkspaceIntelligencePackageSummary {
  path: string;
  name?: string;
  role:
    | "frontend_ui"
    | "backend_runtime"
    | "provider_integrations"
    | "shared_contracts"
    | "cli_entrypoint"
    | "shared_utilities"
    | "shared_package";
  scripts: string[];
}

export interface WorkspaceIntelligenceCommand {
  command: string;
  reason: string;
  priority: "verification" | "quality" | "dev";
}

export interface WorkspaceIntelligenceDocEntry {
  path: string;
  kind: "readme" | "docs" | "guide" | "wiki";
}

export interface WorkspaceIntelligenceSummary {
  // existing fields...
  workspaceKind?: "monorepo" | "node_app" | "unknown";
  topLevelDirectories?: string[];
  keyDirectories?: WorkspaceIntelligenceKeyDirectory[];
  packages?: WorkspaceIntelligencePackageSummary[];
  documentationEntries?: WorkspaceIntelligenceDocEntry[];
  verificationCommands?: WorkspaceIntelligenceCommand[];
  fileConstraints?: string[];
}
```

- [ ] **Step 4: Run test to verify the new type shape compiles but behavior still fails**

Run: `pnpm vitest packages/server/src/__tests__/workspace/intelligence.test.ts`

Expected: FAIL on assertions rather than type/property-missing errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/types.ts packages/server/src/__tests__/workspace/intelligence.test.ts
git commit -m "feat: extend workspace intelligence summary types"
```

## Task 2: Implement Richer Workspace Intelligence Inference

**Files:**
- Modify: `packages/server/src/workspace/intelligence.ts`
- Test: `packages/server/src/__tests__/workspace/intelligence.test.ts`

- [ ] **Step 1: Write the next failing test for conservative selection limits**

Add a second test in `packages/server/src/__tests__/workspace/intelligence.test.ts`:

```ts
it("caps key directories and skips noisy root folders", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-noise-"));
  tempDirs.push(rootPath);

  await writeFile(join(rootPath, "package.json"), JSON.stringify({ scripts: {} }));
  await mkdir(join(rootPath, "packages", "core"), { recursive: true });
  await writeFile(join(rootPath, "packages", "core", "package.json"), JSON.stringify({ name: "@repo/core" }));
  await mkdir(join(rootPath, "packages", "providers"), { recursive: true });
  await writeFile(join(rootPath, "packages", "providers", "package.json"), JSON.stringify({ name: "@repo/providers" }));
  await mkdir(join(rootPath, "node_modules"), { recursive: true });
  await mkdir(join(rootPath, ".git"), { recursive: true });
  await mkdir(join(rootPath, "scripts"), { recursive: true });
  await mkdir(join(rootPath, "e2e"), { recursive: true });

  const summary = await inspectWorkspaceIntelligence({ workspaceId: "ws-1", rootPath });

  expect(summary.keyDirectories?.length).toBeLessThanOrEqual(6);
  expect(summary.keyDirectories?.map((entry) => entry.path)).not.toContain("node_modules");
  expect(summary.topLevelDirectories).not.toContain(".git");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/server/src/__tests__/workspace/intelligence.test.ts`

Expected: FAIL because the current intelligence builder does not collect or filter these structures.

- [ ] **Step 3: Implement deterministic repository inference helpers**

Refactor `packages/server/src/workspace/intelligence.ts` to:

- read root `package.json` scripts once and preserve current command behavior
- discover top-level directories with filtering for hidden/system noise
- scan `packages/*/package.json`
- infer package roles from path/name
- select 3-6 key directories in stable order
- derive documentation entries from `README.md`, `docs/help/*`, and `docs/wiki/*`
- derive verification commands from root scripts using explicit priority
- derive compact file-constraint strings from repo shape

Use helpers like:

```ts
function inferWorkspaceKind(rootPath: string, packageEntries: PackageEntry[]): WorkspaceKind
function inferPackageRole(packagePath: string, packageName?: string): WorkspaceIntelligencePackageSummary["role"]
function selectKeyDirectories(input: {
  packageEntries: PackageEntry[];
  rootDirectories: string[];
  docs: WorkspaceIntelligenceDocEntry[];
}): WorkspaceIntelligenceKeyDirectory[]
function buildVerificationCommands(
  packageManager: PackageManager | undefined,
  rootScripts: Record<string, string>
): WorkspaceIntelligenceCommand[]
function buildFileConstraints(summary: {
  workspaceKind: WorkspaceKind;
  keyDirectories: WorkspaceIntelligenceKeyDirectory[];
}): string[]
```

Keep the inference conservative:

- omit uncertain facts instead of guessing
- prefer stable ordering over filesystem order
- cap list sizes aggressively

- [ ] **Step 4: Run the focused intelligence tests to verify they pass**

Run: `pnpm vitest packages/server/src/__tests__/workspace/intelligence.test.ts`

Expected: PASS

- [ ] **Step 5: Run the existing agent instructions tests that depend on workspace intelligence**

Run: `pnpm vitest packages/server/src/__tests__/agent-instructions-command.test.ts packages/server/src/__tests__/agent-instructions/generator.test.ts`

Expected: FAIL in deterministic output expectations because the section contract has not been updated yet.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/workspace/intelligence.ts packages/server/src/__tests__/workspace/intelligence.test.ts
git commit -m "feat: infer richer workspace intelligence for agent instructions"
```

## Task 3: Update Prompt Contract for Richer Agent Output

**Files:**
- Modify: `packages/server/src/agent-instructions/prompt.ts`
- Test: `packages/server/src/__tests__/agent-instructions-command.test.ts`

- [ ] **Step 1: Add a failing prompt expectation test**

In `packages/server/src/__tests__/agent-instructions-command.test.ts`, add a focused case that captures the prompt passed into the provider command builder:

```ts
it("builds a richer generation prompt with architecture and file-constraint sections", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-prompt-rich-"));
  tempDirs.push(rootPath);

  const commandBuilder = vi.fn((_config, _scenario, req) => ({
    argv: ["codex", "exec", req.prompt],
  }));
  runCommandAsStringMock.mockResolvedValue({
    stdout: codexJsonlPayload(generationPayload("# Agent Instructions\\n\\n## Project Overview\\n")),
    stderr: "",
  });

  await dispatch(
    {
      kind: "command",
      id: "agent-instructions-rich-prompt",
      op: "agentInstructions.generateByAgent",
      args: { workspaceId: "ws-1", providerId: "codex" },
    },
    createContext(rootPath, {
      providerRegistry: [
        createAgentGenerationProvider({
          commandBuilder,
        }),
      ],
    })
  );

  const prompt = commandBuilder.mock.calls[0]?.[2]?.prompt as string;
  expect(prompt).toContain("Architecture Map");
  expect(prompt).toContain("Key Directories");
  expect(prompt).toContain("File Constraints");
  expect(prompt).toContain("Review Checklist");
  expect(prompt).toContain("Use a Markdown hierarchy under 'Architecture Map'");
  expect(prompt).toContain("List only 3-6 key directories");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/server/src/__tests__/agent-instructions-command.test.ts`

Expected: FAIL because the prompt still asks for the old five-section document.

- [ ] **Step 3: Rewrite the prompt to use the richer section contract**

Update `packages/server/src/agent-instructions/prompt.ts` so it:

- requests the new eight-section order
- explicitly asks for a pure Markdown hierarchy in `Architecture Map`
- limits `Key Directories` to 3-6 items
- asks for short, concrete `File Constraints`
- renames rule-oriented sections to `Workflow Expectations` and `Review Checklist`
- still requires exact JSON output and no commentary

The section contract should look like:

```ts
const REQUIRED_WORKFLOW_EXPECTATIONS = [
  "Keep changes focused on the requested task.",
  "Do not revert user changes unless explicitly asked.",
  "Prefer the project's existing patterns.",
  "Run the relevant verification command before reporting completion.",
] as const;

const REQUIRED_REVIEW_CHECKLIST = [
  "Summarize changed files.",
  "Report verification commands and results.",
  "Call out risks, skipped tests, and assumptions.",
] as const;
```

And the prompt should include lines like:

```ts
"Use exactly these second-level sections in this order:",
"- Project Overview",
"- Architecture Map",
"- Key Directories",
"- Development Commands",
"- Workflow Expectations",
"- File Constraints",
"- Review Checklist",
"- Provider Notes",
"Use a Markdown hierarchy under 'Architecture Map'.",
"List only 3-6 entries under 'Key Directories'.",
```

- [ ] **Step 4: Run the prompt-focused command test to verify it passes**

Run: `pnpm vitest packages/server/src/__tests__/agent-instructions-command.test.ts`

Expected: PASS for the new prompt expectations, with possible failures still remaining in deterministic generator tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agent-instructions/prompt.ts packages/server/src/__tests__/agent-instructions-command.test.ts
git commit -m "feat: enrich agent instructions generation prompt"
```

## Task 4: Align the Deterministic Generator with the New Section Shape

**Files:**
- Modify: `packages/server/src/agent-instructions/generator.ts`
- Modify: `packages/server/src/__tests__/agent-instructions/generator.test.ts`

- [ ] **Step 1: Update the deterministic generator test first**

Rewrite `packages/server/src/__tests__/agent-instructions/generator.test.ts` to assert the new compact structure:

```ts
expect(buildAgentInstructionsMarkdown(summary)).toBe(
  [
    "# Agent Instructions",
    "",
    "## Project Overview",
    "",
    "- This workspace is a monorepo on branch `main`.",
    "",
    "## Architecture Map",
    "",
    "- packages/",
    "  - web: frontend UI",
    "  - server: backend runtime and websocket commands",
    "",
    "## Key Directories",
    "",
    "- `packages/web`: frontend UI and workspace interactions.",
    "- `packages/server`: backend runtime and command dispatch.",
    "",
    "## Development Commands",
    "",
    "- `pnpm ci:verify`",
    "- `pnpm test`",
    "- `pnpm dev`",
    "",
    "## Workflow Expectations",
    "",
    "- Keep changes focused on the requested task.",
    // ...
  ].join("\\n")
);
```

- [ ] **Step 2: Run the deterministic generator test to verify it fails**

Run: `pnpm vitest packages/server/src/__tests__/agent-instructions/generator.test.ts`

Expected: FAIL because the current static generator still emits the old five-section layout.

- [ ] **Step 3: Implement the minimal deterministic generator update**

Update `packages/server/src/agent-instructions/generator.ts` to render:

- compact overview from new summary fields
- Markdown hierarchy under `Architecture Map`
- bullet list for `Key Directories`
- stronger command list using `verificationCommands` first, then existing recommended commands
- `Workflow Expectations`, `File Constraints`, and `Review Checklist` sections

Use helper-style rendering functions so the output remains deterministic:

```ts
function renderArchitectureMap(summary: WorkspaceIntelligenceSummary): string[]
function renderKeyDirectories(summary: WorkspaceIntelligenceSummary): string[]
function renderDevelopmentCommands(summary: WorkspaceIntelligenceSummary): string[]
function renderFileConstraints(summary: WorkspaceIntelligenceSummary): string[]
```

Keep the fallback compact even if optional richer fields are missing.

- [ ] **Step 4: Run the deterministic generator and command-level test suite**

Run: `pnpm vitest packages/server/src/__tests__/agent-instructions/generator.test.ts packages/server/src/__tests__/agent-instructions-command.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agent-instructions/generator.ts packages/server/src/__tests__/agent-instructions/generator.test.ts
git commit -m "feat: align static agent instructions generator with richer layout"
```

## Task 5: Full Verification and Real Codex Generation

**Files:**
- Verify only: `packages/server/src/workspace/intelligence.ts`
- Verify only: `packages/server/src/agent-instructions/prompt.ts`
- Verify only: `packages/server/src/agent-instructions/generator.ts`
- Output: `.coder-studio/agent.md`

- [ ] **Step 1: Run the full targeted server verification suite**

Run:

```bash
pnpm vitest \
  packages/server/src/__tests__/workspace/intelligence.test.ts \
  packages/server/src/__tests__/agent-instructions/generator.test.ts \
  packages/server/src/__tests__/agent-instructions-command.test.ts \
  packages/server/src/__tests__/provider-runtime/command-runner.test.ts
```

Expected: PASS

- [ ] **Step 2: Start a real server instance without provider mocks**

Run:

```bash
env HOST=127.0.0.1 PORT=35153 STATE_DIR=/tmp/coder-studio-real-e2e.a0UvvH/state RUNTIME_DIR=/tmp/coder-studio-real-e2e.a0UvvH/runtime NO_AUTH=true pnpm exec tsx packages/server/src/server.ts
```

Expected: server listens on `http://127.0.0.1:35153`

- [ ] **Step 3: Exercise the real WS command path with Codex**

Run a minimal WS client that sends:

```js
activation.claim
workspace.open
workspace.activate
agentInstructions.generateAndWriteByAgent
```

Use:

```bash
node scripts/tmp-run-agent-instructions-ws-check.js
```

Expected: success result with `meta.providerId === "codex"` and a written `.coder-studio/agent.md`

If a temporary script is needed, create it under `scripts/` and delete it before final commit unless the repository benefits from keeping it.

- [ ] **Step 4: Inspect the generated file content**

Run:

```bash
sed -n '1,220p' .coder-studio/agent.md
```

Expected content includes:

- `## Architecture Map`
- `## Key Directories`
- `## File Constraints`
- more than just `pnpm dev/build/lint`

- [ ] **Step 5: Commit implementation if all verification passes**

```bash
git add packages/core/src/domain/types.ts \
  packages/server/src/workspace/intelligence.ts \
  packages/server/src/agent-instructions/prompt.ts \
  packages/server/src/agent-instructions/generator.ts \
  packages/server/src/__tests__/workspace/intelligence.test.ts \
  packages/server/src/__tests__/agent-instructions/generator.test.ts \
  packages/server/src/__tests__/agent-instructions-command.test.ts
git commit -m "feat: enrich generated agent instructions"
```

## Self-Review

Spec coverage check:

- richer architecture map: covered by Tasks 2-4
- key directories: covered by Tasks 1-4
- stronger command guidance: covered by Tasks 2-4
- file constraints and workflow/review guidance: covered by Tasks 2-4
- real Codex verification: covered by Task 5

Placeholder scan:

- no `TODO` or `TBD`
- all file paths are explicit
- all verification commands are explicit

Type consistency check:

- new summary fields are introduced in Task 1 before later tasks consume them
- prompt section names are defined in Task 3 before generator alignment in Task 4
- real verification path in Task 5 matches the known working WS flow
