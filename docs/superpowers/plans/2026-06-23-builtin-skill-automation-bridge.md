# Built-in Skill Automation Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PATH-based built-in skill automation with mounted `cmd.mjs` bridges that execute against the exact session runtime through an injected internal automation entry.

**Architecture:** Keep the existing websocket command bus and backend ops such as `memory.create`, `canvas.create`, and `uiAction.dispatch`. Add a dedicated internal CLI entry for dotted automation ops, ship a shared `cmd.mjs` bridge with built-in automation skills, force rendered copy mounts for those skills, and inject a resolved `CODER_STUDIO_AUTOMATION_ENTRY` into agent sessions so mounted skills never depend on global `coder-studio` resolution.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing `@spencer-kit/coder-studio` CLI package, existing `@coder-studio/server` skill/session managers, websocket automation client.

**Spec reference:** `docs/superpowers/specs/2026-06-23-builtin-skill-automation-bridge-design.md`

**Git hygiene:** The worktree already contains unrelated edits in `packages/cli`, `packages/core`, and `packages/server`. Read those files before patching, stage only the files for the current task, and never revert unrelated user changes.

---

## File Structure

**New files:**
- `packages/cli/src/automation-entry.ts` — internal session-scoped automation entry that accepts dotted ops like `memory.create` and forwards them through the existing websocket command client
- `packages/cli/src/automation-entry.test.ts` — parser and dispatch coverage for the internal automation entry
- `packages/server/src/skills/builtin/automation-bridge.ts` — shared `cmd.mjs` source, render helpers, and automation-mount constants
- `packages/server/src/__tests__/skills/builtin-automation-bridge.test.ts` — verifies `cmd.mjs` env validation, delegation, and exit-code forwarding
- `packages/server/src/session/automation-entry-path.ts` — resolves the absolute dev/dist path for the internal automation entry
- `packages/server/src/__tests__/session-automation-entry-path.test.ts` — dev/dist resolution coverage for the injected automation entry path

**Modified files:**
- `packages/cli/src/automation-command-client.ts` — add a strict session-scoped resolution mode that refuses global server discovery
- `packages/cli/src/automation-command-client.test.ts` — cover strict session mode and existing bearer-header behavior
- `packages/server/src/skills/builtin/definitions/types.ts` — allow built-in skills to declare extra managed files and mount rendering behavior
- `packages/server/src/skills/builtin/materialize.ts` — materialize `SKILL.md` plus managed files such as `cmd.mjs`
- `packages/server/src/skills/mount-manager.ts` — support forced-copy mounts plus mounted file overrides for rendered skills
- `packages/server/src/skills/builtin/sync-manager.ts` — detect automation built-ins and pass render/copy options into the mount manager
- `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts` — switch examples to `node "<absolute...>/cmd.mjs" memory.*`
- `packages/server/src/skills/builtin/definitions/coder-studio-open.ts` — switch examples to `node "<absolute...>/cmd.mjs" ui.*`
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts` — switch examples to `node "<absolute...>/cmd.mjs" canvas.*`
- `packages/server/src/session/manager.ts` — inject `CODER_STUDIO_AUTOMATION_ENTRY` into agent sessions
- `packages/server/src/__tests__/skills/builtin-registry.test.ts` — cover managed files and generic library skill content
- `packages/server/src/__tests__/skills/mount-manager.test.ts` — cover forced-copy rendered mounts
- `packages/server/src/__tests__/skills/builtin-sync-manager.test.ts` — cover rendered auto-mount behavior
- `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts` — cover builtin library files, mounted `cmd.mjs`, and target-specific `SKILL.md`
- `packages/server/src/__tests__/session-integration.test.ts` — cover `CODER_STUDIO_AUTOMATION_ENTRY` session env injection

**Testing commands used in this plan:**
- `pnpm --filter @spencer-kit/coder-studio exec vitest run src/automation-command-client.test.ts src/automation-entry.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/skills/builtin-automation-bridge.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/mount-manager.test.ts src/__tests__/skills/builtin-sync-manager.test.ts src/__tests__/server-builtin-skills-wiring.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/session-automation-entry-path.test.ts src/__tests__/session-integration.test.ts`
- `pnpm ci:verify`

---

### Task 1: Add The Internal Session-Scoped Automation Entry

**Files:**
- Create: `packages/cli/src/automation-entry.ts`
- Create: `packages/cli/src/automation-entry.test.ts`
- Modify: `packages/cli/src/automation-command-client.ts`
- Modify: `packages/cli/src/automation-command-client.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

Add `packages/cli/src/automation-entry.test.ts` with focused parser/dispatch coverage:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const { callCoderStudioCommand } = vi.hoisted(() => ({
  callCoderStudioCommand: vi.fn(),
}));

vi.mock("./automation-command-client.js", () => ({
  callCoderStudioCommand,
}));

import { runAutomationEntry } from "./automation-entry.js";

describe("automation entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("maps memory.create to the existing websocket op shape", async () => {
    vi.stubEnv("CODER_STUDIO_API_URL", "http://127.0.0.1:4173");
    vi.stubEnv("CODER_STUDIO_WORKSPACE_ID", "ws-1");
    callCoderStudioCommand.mockResolvedValueOnce({ id: "mem-1" });

    await runAutomationEntry([
      "memory.create",
      "--type",
      "issue",
      "--content",
      "Investigate canvas mount",
      "--status",
      "not_started",
      "--skill",
      "coder-studio-memory",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      op: "memory.create",
      args: {
        workspaceId: "ws-1",
        type: "issue",
        content: "Investigate canvas mount",
        status: "not_started",
        sourceHint: { skillSlug: "coder-studio-memory" },
      },
      resolveStrategy: "session",
    });
  });

  it("maps ui.open-file to uiAction.dispatch", async () => {
    vi.stubEnv("CODER_STUDIO_API_URL", "http://127.0.0.1:4173");
    vi.stubEnv("CODER_STUDIO_WORKSPACE_ID", "ws-1");
    callCoderStudioCommand.mockResolvedValueOnce({ accepted: true });

    await runAutomationEntry([
      "ui.open-file",
      "--path",
      "packages/server/src/session/manager.ts",
      "--line",
      "12",
      "--column",
      "3",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "editor.openFile",
          path: "packages/server/src/session/manager.ts",
          line: 12,
          column: 3,
        },
        source: { kind: "agent" },
      },
      resolveStrategy: "session",
    });
  });
});
```

Extend `packages/cli/src/automation-command-client.test.ts` with a failure case:

```ts
  it("rejects session-scoped calls when api url is unavailable", async () => {
    vi.stubEnv("CODER_STUDIO_API_URL", "");
    getServerStatus.mockResolvedValue(null);
    getBrowserUrl.mockReturnValue(undefined);

    await expect(
      callCoderStudioCommand({
        op: "memory.list",
        args: { workspaceId: "ws-1" },
        resolveStrategy: "session",
      })
    ).rejects.toThrow("CODER_STUDIO_API_URL");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/automation-command-client.test.ts src/automation-entry.test.ts
```

Expected: FAIL because `automation-entry.ts` does not exist and the command client still falls back to managed-server discovery.

- [ ] **Step 3: Implement the internal automation entry and strict client mode**

Create `packages/cli/src/automation-entry.ts` with a dedicated entrypoint instead of reusing the public `coder-studio` parser:

```ts
import { callCoderStudioCommand } from "./automation-command-client.js";

type AutomationOp =
  | "memory.list"
  | "memory.search"
  | "memory.get"
  | "memory.create"
  | "memory.update"
  | "memory.delete"
  | "canvas.list"
  | "canvas.create"
  | "canvas.update"
  | "canvas.render"
  | "ui.open-file"
  | "ui.close-file"
  | "ui.open-url"
  | "ui.close-url"
  | "ui.open-canvas";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Coder Studio automation is not available in this session. Missing ${name}.`);
  }
  return value;
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function buildArgs(op: AutomationOp, flags: Record<string, string | boolean>) {
  const workspaceId = readRequiredEnv("CODER_STUDIO_WORKSPACE_ID");
  switch (op) {
    case "memory.create":
      return {
        workspaceId,
        type: String(flags.type),
        content: String(flags.content),
        ...(typeof flags.status === "string" ? { status: flags.status } : {}),
        ...(typeof flags.skill === "string"
          ? { sourceHint: { skillSlug: flags.skill } }
          : {}),
      };
    case "memory.list":
      return {
        workspaceId,
        ...(typeof flags.type === "string" ? { type: flags.type } : {}),
        ...(typeof flags.query === "string" ? { query: flags.query } : {}),
      };
    case "memory.search":
      return {
        workspaceId,
        query: String(flags.query),
        ...(typeof flags.type === "string" ? { type: flags.type } : {}),
      };
    case "memory.get":
    case "memory.delete":
      return { workspaceId, id: String(flags.id) };
    case "memory.update":
      return {
        workspaceId,
        id: String(flags.id),
        ...(typeof flags.type === "string" ? { type: flags.type } : {}),
        ...(typeof flags.content === "string" ? { content: flags.content } : {}),
        ...(typeof flags.status === "string" ? { status: flags.status } : {}),
      };
    case "canvas.list":
      return { workspaceId };
    case "canvas.create":
      return {
        workspaceId,
        kind: String(flags.kind),
        title: String(flags.title),
        documentJson: String(flags["document-json"]),
        ...(flags.open === true ? { open: true } : {}),
      };
    case "canvas.update":
      return {
        workspaceId,
        canvasId: String(flags.canvas),
        documentJson: String(flags["document-json"]),
      };
    case "canvas.render":
      return {
        workspaceId,
        canvasId: String(flags.canvas),
      };
    case "ui.open-file":
      return {
        workspaceId,
        intent: {
          type: "editor.openFile",
          path: String(flags.path),
          ...(typeof flags.line === "string" ? { line: Number(flags.line) } : {}),
          ...(typeof flags.column === "string" ? { column: Number(flags.column) } : {}),
        },
        source: { kind: "agent" as const },
      };
    case "ui.close-file":
      return {
        workspaceId,
        intent: {
          type: "editor.closeFile",
          path: String(flags.path),
        },
        source: { kind: "agent" as const },
      };
    case "ui.open-url":
      return {
        workspaceId,
        intent: {
          type: "browser.openUrl",
          url: String(flags.url),
        },
        source: { kind: "agent" as const },
      };
    case "ui.close-url":
      return {
        workspaceId,
        intent: {
          type: "browser.closeUrl",
          url: String(flags.url),
        },
        source: { kind: "agent" as const },
      };
    case "ui.open-canvas":
      return {
        workspaceId,
        intent: {
          type: "canvas.open",
          canvasId: String(flags.canvas),
        },
        source: { kind: "agent" as const },
      };
  }
}

export async function runAutomationEntry(argv = process.argv.slice(2)): Promise<void> {
  const [opToken, ...flagTokens] = argv;
  if (!opToken) {
    throw new Error("Missing automation op. Expected values like memory.create or ui.open-file.");
  }

  const op = opToken as AutomationOp;
  const apiUrl = readRequiredEnv("CODER_STUDIO_API_URL");
  const flags = parseFlags(flagTokens);
  const result = await callCoderStudioCommand({
    apiUrl,
    op: op.startsWith("ui.") ? "uiAction.dispatch" : op,
    args: buildArgs(op, flags),
    resolveStrategy: "session",
  });

  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(JSON.stringify(result));
}

if (process.argv[1]?.endsWith("automation-entry.ts") || process.argv[1]?.endsWith("automation-entry.js")) {
  void runAutomationEntry().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

Update `packages/cli/src/automation-command-client.ts` to make session-scoped behavior explicit:

```ts
export interface CoderStudioCommandInput {
  apiUrl?: string;
  op: string;
  args: unknown;
  timeoutMs?: number;
  resolveStrategy?: "auto" | "session";
}

async function resolveApiUrl(
  explicitApiUrl: string | undefined,
  resolveStrategy: "auto" | "session" = "auto"
): Promise<string> {
  if (explicitApiUrl) {
    return explicitApiUrl;
  }

  if (process.env.CODER_STUDIO_API_URL) {
    return process.env.CODER_STUDIO_API_URL;
  }

  if (resolveStrategy === "session") {
    throw new Error(
      "Coder Studio automation is not available in this session. Missing CODER_STUDIO_API_URL."
    );
  }

  const status = await getServerStatus();
  const browserUrl = getBrowserUrl(status);
  if (browserUrl) {
    return browserUrl;
  }

  throw new Error(
    "Unable to find a running Coder Studio server. Start it first or pass --api-url."
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/automation-command-client.test.ts src/automation-entry.test.ts
```

Expected: PASS. The new entry should use only `CODER_STUDIO_API_URL` and should never attempt managed-server discovery in session mode.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/automation-entry.ts packages/cli/src/automation-entry.test.ts packages/cli/src/automation-command-client.ts packages/cli/src/automation-command-client.test.ts
git commit -m "feat(cli): add session-scoped automation entry"
```

---

### Task 2: Materialize Shared Automation Bridge Files For Built-in Skills

**Files:**
- Create: `packages/server/src/skills/builtin/automation-bridge.ts`
- Create: `packages/server/src/__tests__/skills/builtin-automation-bridge.test.ts`
- Modify: `packages/server/src/skills/builtin/definitions/types.ts`
- Modify: `packages/server/src/skills/builtin/materialize.ts`
- Modify: `packages/server/src/__tests__/skills/builtin-registry.test.ts`

- [ ] **Step 1: Write the failing server tests**

Add `packages/server/src/__tests__/skills/builtin-automation-bridge.test.ts`:

```ts
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_CMD_FILE_NAME,
  BUILTIN_AUTOMATION_BRIDGE_SOURCE,
} from "../../skills/builtin/automation-bridge.js";

describe("builtin automation bridge", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when required session env is missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "builtin-automation-bridge-"));
    const cmdPath = join(tempDir, AUTOMATION_CMD_FILE_NAME);
    await writeFile(cmdPath, BUILTIN_AUTOMATION_BRIDGE_SOURCE, "utf8");

    const result = spawnSync(process.execPath, [cmdPath, "memory.list"], {
      env: {},
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CODER_STUDIO_API_URL");
  });

  it("delegates to the injected automation entry and preserves exit code", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "builtin-automation-bridge-"));
    const cmdPath = join(tempDir, AUTOMATION_CMD_FILE_NAME);
    const entryPath = join(tempDir, "fake-automation-entry.mjs");
    await writeFile(cmdPath, BUILTIN_AUTOMATION_BRIDGE_SOURCE, "utf8");
    await writeFile(
      entryPath,
      'console.log(JSON.stringify(process.argv.slice(2))); process.exit(7);',
      "utf8"
    );
    await chmod(entryPath, 0o755);

    const result = spawnSync(process.execPath, [cmdPath, "memory.list", "--json"], {
      env: {
        ...process.env,
        CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
        CODER_STUDIO_WORKSPACE_ID: "ws-1",
        CODER_STUDIO_SESSION_TOKEN: "token-1",
        CODER_STUDIO_AUTOMATION_ENTRY: entryPath,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(7);
    expect(result.stdout).toContain('"memory.list"');
  });
});
```

Extend `packages/server/src/__tests__/skills/builtin-registry.test.ts` with expectations like:

```ts
    expect(memoryEntry).toMatchObject({
      slug: "coder-studio-memory",
      builtin: { autoMount: true },
    });
    await expect(readFile(join(memoryEntry!.libraryPath, "cmd.mjs"), "utf8")).resolves.toContain(
      "CODER_STUDIO_AUTOMATION_ENTRY"
    );
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/skills/builtin-automation-bridge.test.ts
```

Expected: FAIL because built-in skills do not ship `cmd.mjs`, and the bridge module does not exist.

- [ ] **Step 3: Implement shared bridge source and managed-file materialization**

Create `packages/server/src/skills/builtin/automation-bridge.ts`:

```ts
import { join } from "node:path";

export const AUTOMATION_CMD_FILE_NAME = "cmd.mjs";
export const AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN = "<absolute-mounted-skill-path>/cmd.mjs";

export const BUILTIN_AUTOMATION_BRIDGE_SOURCE = `import { spawn } from "node:child_process";

const REQUIRED_ENV = [
  "CODER_STUDIO_API_URL",
  "CODER_STUDIO_WORKSPACE_ID",
  "CODER_STUDIO_SESSION_TOKEN",
  "CODER_STUDIO_AUTOMATION_ENTRY",
];

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      \`Coder Studio automation is not available in this session. Missing \${name}.\`
    );
  }
  return value;
}

for (const key of REQUIRED_ENV) {
  readRequiredEnv(key);
}

const entry = process.env.CODER_STUDIO_AUTOMATION_ENTRY;
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;

export interface MountedSkillOverride {
  relativePath: string;
  content: string;
}

export function renderMountedAutomationCommand(targetPath: string): string {
  return `node "${join(targetPath, AUTOMATION_CMD_FILE_NAME)}"`;
}

export function renderMountedSkillContent(content: string, targetPath: string): string {
  return content.replaceAll(
    AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
    join(targetPath, AUTOMATION_CMD_FILE_NAME)
  );
}
```

Extend `packages/server/src/skills/builtin/definitions/types.ts`:

```ts
export interface BuiltinSkillManagedFile {
  relativePath: string;
  content: string;
}

export interface BuiltinSkillDefinition {
  slug: string;
  displayName: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  autoMountInMvp: boolean;
  content: string;
  files?: readonly BuiltinSkillManagedFile[];
  mountRendering?: "none" | "automation_bridge";
}
```

Update `packages/server/src/skills/builtin/materialize.ts` to write declared files after `SKILL.md`:

```ts
    await writeFile(join(libraryPath, "SKILL.md"), `${skill.content.trimEnd()}\n`, "utf8");
    for (const file of skill.files ?? []) {
      const targetPath = join(libraryPath, file.relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, file.content, "utf8");
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/skills/builtin-automation-bridge.test.ts
```

Expected: PASS. Built-in library entries should now include `cmd.mjs`, and the shared bridge should validate env plus delegate exit status.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/skills/builtin/automation-bridge.ts packages/server/src/__tests__/skills/builtin-automation-bridge.test.ts packages/server/src/skills/builtin/definitions/types.ts packages/server/src/skills/builtin/materialize.ts packages/server/src/__tests__/skills/builtin-registry.test.ts
git commit -m "feat(server): materialize builtin automation bridges"
```

---

### Task 3: Render Automation Skills As Forced-Copy Mounts

**Files:**
- Modify: `packages/server/src/skills/mount-manager.ts`
- Modify: `packages/server/src/skills/builtin/sync-manager.ts`
- Modify: `packages/server/src/__tests__/skills/mount-manager.test.ts`
- Modify: `packages/server/src/__tests__/skills/builtin-sync-manager.test.ts`

- [ ] **Step 1: Write the failing mount tests**

Add one `mount-manager` test that forces rendered overrides:

```ts
  it("uses copy mode and writes mounted overrides when requested", async () => {
    const relation = await manager.mount({
      providerId: "codex",
      skillSlug: "my-review-skill",
      enabled: true,
      preferredMode: "copy",
      mountedOverrides: [
        {
          relativePath: "SKILL.md",
          content: 'node "/tmp/codex-skills/my-review-skill/cmd.mjs" memory.list --json\n',
        },
      ],
    });

    expect(relation.mountModeResolved).toBe("copy");
    await expect(readFile(join(skillDir, "my-review-skill", "SKILL.md"), "utf8")).resolves.toContain(
      'node "/tmp/codex-skills/my-review-skill/cmd.mjs"'
    );
  });
```

Add one `builtin-sync-manager` test that proves automation skills are mounted as rendered copies:

```ts
    expect(result.mounted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "codex",
          skillSlug: "coder-studio-memory",
          mountModeResolved: "copy",
        }),
      ])
    );
    await expect(
      readFile(join(skillDir, "coder-studio-memory", "SKILL.md"), "utf8")
    ).resolves.toContain(`node "${join(skillDir, "coder-studio-memory", "cmd.mjs")}"`);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/mount-manager.test.ts src/__tests__/skills/builtin-sync-manager.test.ts
```

Expected: FAIL because mount plans cannot force `copy`, and mounted `SKILL.md` content is not rewritten with target-specific paths.

- [ ] **Step 3: Implement forced-copy mount plans and mounted overrides**

Extend `packages/server/src/skills/mount-manager.ts`:

```ts
export interface SkillMountPlan {
  providerId: string;
  skillSlug: string;
  enabled: boolean;
  preferredMode?: "auto" | "copy";
  mountedOverrides?: Array<{
    relativePath: string;
    content: string;
  }>;
}
```

Change the mount flow so `preferredMode: "copy"` skips symlink attempts and writes overrides after copy:

```ts
    const preferredMode = input.preferredMode ?? "auto";
    let mountModeResolved: SkillMountRelation["mountModeResolved"] =
      preferredMode === "copy" ? "copy" : "symlink";

    await rm(targetPath, { recursive: true, force: true });
    if (preferredMode === "copy") {
      await copyRecursively(libraryEntry.libraryPath, targetPath);
    } else {
      try {
        await symlink(libraryEntry.libraryPath, targetPath);
      } catch {
        mountModeResolved = "copy";
        await copyRecursively(libraryEntry.libraryPath, targetPath);
      }
    }

    for (const override of input.mountedOverrides ?? []) {
      const overridePath = join(targetPath, override.relativePath);
      await mkdir(dirname(overridePath), { recursive: true });
      await writeFile(overridePath, override.content, "utf8");
    }
```

Update `packages/server/src/skills/builtin/sync-manager.ts` to build automation mount overrides from definitions:

```ts
import {
  AUTOMATION_CMD_FILE_NAME,
  renderMountedSkillContent,
} from "./automation-bridge.js";

const definitionBySlug = new Map((this.deps.skills ?? BUILTIN_SKILLS).map((skill) => [skill.slug, skill]));

        const definition = definitionBySlug.get(entry.slug);
        const targetPath = join(provider.skillMountDirectories![0], entry.slug);
        const mountedOverrides =
          definition?.mountRendering === "automation_bridge"
            ? [
                {
                  relativePath: "SKILL.md",
                  content: `${renderMountedSkillContent(definition.content, targetPath).trimEnd()}\n`,
                },
              ]
            : undefined;

        const relation = await this.deps.skillMountMgr.mount({
          providerId: provider.id,
          skillSlug: entry.slug,
          enabled: true,
          preferredMode:
            definition?.mountRendering === "automation_bridge" ? "copy" : "auto",
          mountedOverrides,
        });
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/mount-manager.test.ts src/__tests__/skills/builtin-sync-manager.test.ts
```

Expected: PASS. Automation skills should mount as `copy`, and their mounted `SKILL.md` should contain the actual provider target path.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/skills/mount-manager.ts packages/server/src/skills/builtin/sync-manager.ts packages/server/src/__tests__/skills/mount-manager.test.ts packages/server/src/__tests__/skills/builtin-sync-manager.test.ts
git commit -m "feat(server): render builtin automation mounts"
```

---

### Task 4: Inject The Resolved Automation Entry Into Agent Sessions

**Files:**
- Create: `packages/server/src/session/automation-entry-path.ts`
- Create: `packages/server/src/__tests__/session-automation-entry-path.test.ts`
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/__tests__/session-integration.test.ts`

- [ ] **Step 1: Write the failing session tests**

Create `packages/server/src/__tests__/session-automation-entry-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAutomationEntryPath } from "../session/automation-entry-path.js";

describe("resolveAutomationEntryPath", () => {
  it("prefers the repo source entry in development worktrees", () => {
    const path = resolveAutomationEntryPath();
    expect(path).toContain("packages/cli/src/automation-entry");
  });
});
```

Extend `packages/server/src/__tests__/session-integration.test.ts` with an env assertion:

```ts
    expect(spawnCalls[0]?.options).toMatchObject({
      env: expect.objectContaining({
        CODER_STUDIO_API_URL: expect.stringContaining("127.0.0.1"),
        CODER_STUDIO_SESSION_TOKEN: expect.any(String),
        CODER_STUDIO_WORKSPACE_ID: expect.any(String),
        CODER_STUDIO_AUTOMATION_ENTRY: expect.stringContaining("automation-entry"),
      }),
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/session-automation-entry-path.test.ts src/__tests__/session-integration.test.ts
```

Expected: FAIL because the resolver helper does not exist and sessions do not inject `CODER_STUDIO_AUTOMATION_ENTRY`.

- [ ] **Step 3: Implement entry-path resolution and session env wiring**

Create `packages/server/src/session/automation-entry-path.ts`:

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_CANDIDATES = [
  new URL("../../../cli/src/automation-entry.ts", import.meta.url),
  new URL("../../../cli/dist/automation-entry.js", import.meta.url),
];

export function resolveAutomationEntryPath(candidates = DEFAULT_CANDIDATES): string {
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error("Unable to locate the Coder Studio automation entry.");
  }
  return fileURLToPath(match);
}
```

Update `packages/server/src/session/manager.ts`:

```ts
import { resolveAutomationEntryPath } from "./automation-entry-path.js";

const automationEntryPath = resolveAutomationEntryPath();

      const terminalSpec: TerminalSpec = {
        workspaceId: req.workspaceId,
        kind: "agent",
        argv: cmd.argv,
        cwd: cmd.cwd,
        env: {
          ...cmd.env,
          CODER_STUDIO: "1",
          CODER_STUDIO_WORKSPACE_ID: req.workspaceId,
          CODER_STUDIO_SESSION_ID: sessionId,
          CODER_STUDIO_PROVIDER_ID: req.providerId,
          CODER_STUDIO_SESSION_TOKEN: tokenRecord.token,
          CODER_STUDIO_AUTOMATION_ENTRY: automationEntryPath,
          [AUTOMATION_PERMISSIONS_ENV]: permissions.join(","),
          ...(this.hostBridge.getHostApiUrl()
            ? { CODER_STUDIO_API_URL: this.hostBridge.getHostApiUrl() }
            : {}),
        },
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/session-automation-entry-path.test.ts src/__tests__/session-integration.test.ts
```

Expected: PASS. New agent sessions should carry an absolute `CODER_STUDIO_AUTOMATION_ENTRY`, and the resolver should pick the repo source entry in development.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/session/automation-entry-path.ts packages/server/src/__tests__/session-automation-entry-path.test.ts packages/server/src/session/manager.ts packages/server/src/__tests__/session-integration.test.ts
git commit -m "feat(server): inject automation entry into sessions"
```

---

### Task 5: Rewrite Built-in Skill Content And Wiring Expectations

**Files:**
- Modify: `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`
- Modify: `packages/server/src/skills/builtin/definitions/coder-studio-open.ts`
- Modify: `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
- Modify: `packages/server/src/__tests__/skills/builtin-registry.test.ts`
- Modify: `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`

- [ ] **Step 1: Write the failing content and wiring tests**

Update `packages/server/src/__tests__/skills/builtin-registry.test.ts` expectations:

```ts
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      'node "<absolute-mounted-skill-path>/cmd.mjs" memory.create --type wiki'
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("coder-studio memory add");
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      'node "<absolute-mounted-skill-path>/cmd.mjs" ui.open-file --path <workspace-relative-path> --json'
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      'node "<absolute-mounted-skill-path>/cmd.mjs" canvas.create --kind architecture_canvas'
    );
```

Update `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`:

```ts
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain(
      'node "<absolute-mounted-skill-path>/cmd.mjs" memory.create'
    );
    expect(existsSync(join(builtinRoot, "coder-studio-memory", "cmd.mjs"))).toBe(true);

    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain(
      `node "${join(tempDir, "home", ".agents", "skills", "coder-studio-memory", "cmd.mjs")}"`
    );
    expect(readFileSync(homeMemorySkillPath, "utf8")).not.toContain("coder-studio memory add");
    expect(existsSync(join(tempDir, "home", ".agents", "skills", "coder-studio-memory", "cmd.mjs"))).toBe(true);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts
```

Expected: FAIL because built-in skill content still references `coder-studio ...` commands and mounted skills do not contain absolute `cmd.mjs` references.

- [ ] **Step 3: Rewrite the three built-in automation skills**

For all three skill definition files, attach the bridge file and mark them as automation-rendered:

```ts
import {
  AUTOMATION_CMD_FILE_NAME,
  BUILTIN_AUTOMATION_BRIDGE_SOURCE,
} from "../automation-bridge.js";

export const CODER_STUDIO_MEMORY_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-memory",
  displayName: "Coder Studio Memory",
  description: "Read and write durable Coder Studio workspace memory on demand.",
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: true,
  mountRendering: "automation_bridge",
  files: [
    {
      relativePath: AUTOMATION_CMD_FILE_NAME,
      content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
    },
  ],
  content: [
    "---",
    "name: coder-studio-memory",
    "description: Read and write durable Coder Studio workspace memory on demand.",
    "---",
    "",
    "# Coder Studio Memory",
    "",
    "Use this skill when you need durable project context or want to leave stable follow-up context for future sessions.",
    "",
    "```bash",
    'node "<absolute-mounted-skill-path>/cmd.mjs" memory.search --query architecture --json',
    'node "<absolute-mounted-skill-path>/cmd.mjs" memory.create --type issue --content "Verify release notes before publishing." --status pending_verification --skill coder-studio-memory --json',
    "```",
    "",
  ].join("\\n"),
};
```

Apply the same shape to `coder-studio-open.ts` and `coder-studio-canvas.ts`, using dotted ops like `ui.open-file`, `ui.close-file`, `ui.open-url`, `ui.close-url`, `ui.open-canvas`, `canvas.create`, `canvas.update`, and `canvas.render`.

- [ ] **Step 4: Run targeted tests and the final repo verification**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts src/__tests__/skills/builtin-sync-manager.test.ts
pnpm ci:verify
```

Expected: PASS. The library copy should contain generic `node "<absolute-mounted-skill-path>/cmd.mjs"` examples, and mounted skills should contain absolute target paths plus `cmd.mjs`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/skills/builtin/definitions/coder-studio-memory.ts packages/server/src/skills/builtin/definitions/coder-studio-open.ts packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts packages/server/src/__tests__/skills/builtin-registry.test.ts packages/server/src/__tests__/server-builtin-skills-wiring.test.ts
git commit -m "feat(server): move builtin automation skills to mounted bridges"
```

---

## Self-Review Checklist

- Spec coverage:
  - built-in skill files gain `cmd.mjs` and managed-file materialization in Task 2
  - rendered copy mounts and target-specific `SKILL.md` happen in Task 3
  - runtime env injection of `CODER_STUDIO_AUTOMATION_ENTRY` happens in Task 4
  - dotted internal automation ops and strict session-only websocket usage happen in Task 1
  - memory/canvas/open skill content migration happens in Task 5
- Placeholder scan:
  - no `TODO`, `TBD`, or “similar to previous task” placeholders remain
  - each task has explicit files, concrete commands, and expected results
- Type consistency:
  - `mountRendering`, `files`, `preferredMode`, `mountedOverrides`, and `resolveStrategy` are used consistently across tasks
