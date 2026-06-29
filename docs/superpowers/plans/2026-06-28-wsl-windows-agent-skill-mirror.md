# WSL Windows Agent Skill Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Windows agent-visible skill directories into the matching WSL home directories during WSL runtime startup so WSL agents see the same skill set immediately.

**Architecture:** Add a server-local snapshot contract for home-relative agent skill roots, a host-side exporter that serializes Windows skill directories through the existing WSL host bridge, and a WSL-side mirror writer that fully replaces each target skill directory before `createNativeRuntime(...)`. Keep runtime state isolated: only mirror agent skill directories, never `library-index.json`, `mounts.json`, `targets.json`, or other runtime-managed state.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest, Zod, existing WSL socket JSON-RPC host bridge, existing workspace host commands, existing provider registry skill directory metadata.

**Conversation decisions:** Sync on WSL startup, not on demand; Windows is the single source of truth; conflicting files overwrite the WSL copy; deletions on Windows delete the WSL mirror; sync failures log and continue startup.

---

## File Structure

**New files:**
- `packages/server/src/runtime/wsl-skill-snapshot.ts` — local snapshot types for home-relative roots, skill directories, and file payloads.
- `packages/server/src/runtime/wsl-skill-export.ts` — host-side helpers that collect distinct home-relative roots from provider definitions and export Windows skill directories as base64 file trees.
- `packages/server/src/runtime/wsl-skill-sync.ts` — WSL-side helpers that request host snapshots and mirror them into the Linux home directory with Windows-authoritative replace/delete semantics.
- `packages/server/src/__tests__/runtime/wsl-skill-export.test.ts` — unit tests for root collection, snapshot export, root dedupe, and file payload serialization.
- `packages/server/src/__tests__/runtime/wsl-skill-sync.test.ts` — unit tests for full-root mirror behavior, overwrite semantics, deletions, and path safety.
- `packages/server/src/__tests__/runtime/wsl-entry-skill-sync.test.ts` — startup-order tests that prove WSL skill sync runs before `createNativeRuntime(...)` and does not block startup on export failure.

**Modified files:**
- `packages/server/src/commands/workspace.ts` — register `workspace.wsl.exportAgentSkills` as a host command and delegate to the exporter.
- `packages/server/src/__tests__/workspace-commands.test.ts` — cover the new host command through normal dispatch.
- `packages/server/src/runtime/wsl-entry.ts` — call the host exporter through `relayHostCommand`, mirror the returned snapshot into WSL, and only then create the native runtime.

**Existing files to read before editing:**
- `packages/server/src/runtime/wsl-entry.ts`
- `packages/server/src/runtime/wsl-runtime.ts`
- `packages/server/src/runtime/wsl-bootstrap.ts`
- `packages/server/src/commands/workspace.ts`
- `packages/server/src/__tests__/runtime/wsl-runtime.test.ts`
- `packages/server/src/__tests__/runtime/wsl-bootstrap.test.ts`
- `packages/server/src/__tests__/workspace-commands.test.ts`

**Verification commands used in this plan:**
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-export.test.ts src/__tests__/workspace-commands.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-sync.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-entry-skill-sync.test.ts src/__tests__/runtime/wsl-bootstrap.test.ts src/__tests__/runtime/wsl-runtime.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-export.test.ts src/__tests__/runtime/wsl-skill-sync.test.ts src/__tests__/runtime/wsl-entry-skill-sync.test.ts src/__tests__/workspace-commands.test.ts src/__tests__/runtime/wsl-bootstrap.test.ts src/__tests__/runtime/wsl-runtime.test.ts`

---

### Task 1: Add The WSL Agent Skill Snapshot Contract And Host Exporter

**Files:**
- Create: `packages/server/src/runtime/wsl-skill-snapshot.ts`
- Create: `packages/server/src/runtime/wsl-skill-export.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-skill-export.test.ts`

- [ ] **Step 1: Write the failing exporter tests**

Create `packages/server/src/__tests__/runtime/wsl-skill-export.test.ts` with:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderDefinition } from "@coder-studio/core";
import {
  collectHomeRelativeSkillRoots,
  exportAgentSkillSnapshot,
} from "../../runtime/wsl-skill-export.js";

function provider(id: string, roots: string[]): ProviderDefinition {
  return {
    id,
    displayName: id,
    badge: id,
    kind: "built_in",
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: [id], env: {}, cwd: "/" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: [id],
    supportsSkillsMount: true,
    skillMountDirectories: roots,
  } satisfies ProviderDefinition;
}

describe("wsl skill export", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
    }
  });

  it("dedupes home-relative roots while preserving shared and provider-specific directories", () => {
    const home = "/Users/tester";
    const roots = collectHomeRelativeSkillRoots(
      [
        provider("codex", ["/Users/tester/.agents/skills", "/Users/tester/.codex/skills"]),
        provider("gemini", ["/Users/tester/.agents/skills", "/Users/tester/.gemini/skills"]),
        provider("claude", ["/Users/tester/.claude/skills"]),
      ],
      home
    );

    expect(roots).toEqual([
      ".agents/skills",
      ".codex/skills",
      ".gemini/skills",
      ".claude/skills",
    ]);
  });

  it("exports each skill directory as base64 file payloads rooted under the user home", async () => {
    root = await mkdtemp(join(tmpdir(), "wsl-skill-export-"));
    const home = join(root, "home");
    const sharedRoot = join(home, ".agents", "skills");
    await mkdir(join(sharedRoot, "code-review", "refs"), { recursive: true });
    await writeFile(join(sharedRoot, "code-review", "SKILL.md"), "# Code Review\\n");
    await writeFile(join(sharedRoot, "code-review", "refs", "guide.md"), "guide\\n");
    await writeFile(join(sharedRoot, "README.txt"), "ignore me\\n");

    const snapshot = await exportAgentSkillSnapshot({
      homePath: home,
      providerRegistry: [provider("codex", [sharedRoot])],
    });

    expect(snapshot.roots).toEqual([
      {
        homeRelativeRoot: ".agents/skills",
        skills: [
          {
            slug: "code-review",
            files: [
              {
                relativePath: "SKILL.md",
                contentBase64: Buffer.from("# Code Review\\n").toString("base64"),
              },
              {
                relativePath: "refs/guide.md",
                contentBase64: Buffer.from("guide\\n").toString("base64"),
              },
            ],
          },
        ],
      },
    ]);
  });

  it("returns empty roots so WSL can delete stale skills when Windows removed them", async () => {
    root = await mkdtemp(join(tmpdir(), "wsl-skill-export-empty-"));
    const home = join(root, "home");
    await mkdir(join(home, ".claude", "skills"), { recursive: true });

    const snapshot = await exportAgentSkillSnapshot({
      homePath: home,
      providerRegistry: [provider("claude", [join(home, ".claude", "skills")])],
    });

    expect(snapshot.roots).toEqual([
      {
        homeRelativeRoot: ".claude/skills",
        skills: [],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the exporter tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-export.test.ts
```

Expected: FAIL because `wsl-skill-export.ts` does not exist yet.

- [ ] **Step 3: Add the snapshot types and exporter**

Create `packages/server/src/runtime/wsl-skill-snapshot.ts` with:

```ts
export interface WslAgentSkillFileSnapshot {
  relativePath: string;
  contentBase64: string;
}

export interface WslAgentSkillDirectorySnapshot {
  slug: string;
  files: WslAgentSkillFileSnapshot[];
}

export interface WslAgentSkillRootSnapshot {
  homeRelativeRoot: string;
  skills: WslAgentSkillDirectorySnapshot[];
}

export interface WslAgentSkillExportSnapshot {
  roots: WslAgentSkillRootSnapshot[];
}
```

Create `packages/server/src/runtime/wsl-skill-export.ts` with:

```ts
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import type {
  WslAgentSkillDirectorySnapshot,
  WslAgentSkillExportSnapshot,
} from "./wsl-skill-snapshot.js";

function isPathInsideHome(homePath: string, absolutePath: string): boolean {
  const rel = relative(homePath, absolutePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeHomeRelativeRoot(homePath: string, absolutePath: string): string | null {
  if (!isPathInsideHome(homePath, absolutePath)) {
    return null;
  }
  const rel = relative(homePath, absolutePath).replace(/\\\\/g, "/");
  return rel.length > 0 ? rel : ".";
}

export function collectHomeRelativeSkillRoots(
  providers: ProviderDefinition[],
  homePath: string = homedir()
): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];

  for (const provider of providers) {
    for (const skillDir of provider.skillMountDirectories ?? []) {
      const rel = normalizeHomeRelativeRoot(homePath, skillDir);
      if (!rel || seen.has(rel)) {
        continue;
      }
      seen.add(rel);
      roots.push(rel);
    }
  }

  return roots;
}

async function exportSkillDirectory(rootPath: string, slug: string): Promise<WslAgentSkillDirectorySnapshot> {
  const files: WslAgentSkillDirectorySnapshot["files"] = [];

  async function walk(relativeDir = ""): Promise<void> {
    const absoluteDir = relativeDir ? join(rootPath, slug, relativeDir) : join(rootPath, slug);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(nextRelative);
        continue;
      }
      const bytes = await readFile(join(rootPath, slug, nextRelative));
      files.push({
        relativePath: nextRelative,
        contentBase64: bytes.toString("base64"),
      });
    }
  }

  await walk();
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { slug, files };
}

export async function exportAgentSkillSnapshot(input: {
  homePath?: string;
  providerRegistry: ProviderDefinition[];
}): Promise<WslAgentSkillExportSnapshot> {
  const homePath = input.homePath ?? homedir();
  const roots = collectHomeRelativeSkillRoots(input.providerRegistry, homePath);

  return {
    roots: await Promise.all(
      roots.map(async (homeRelativeRoot) => {
        const absoluteRoot = join(homePath, homeRelativeRoot);
        let entries = [];
        try {
          entries = await readdir(absoluteRoot, { withFileTypes: true });
        } catch {
          return { homeRelativeRoot, skills: [] };
        }

        const skills: WslAgentSkillDirectorySnapshot[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) {
            continue;
          }
          try {
            await readFile(join(absoluteRoot, entry.name, "SKILL.md"));
          } catch {
            continue;
          }
          skills.push(await exportSkillDirectory(absoluteRoot, entry.name));
        }

        skills.sort((left, right) => left.slug.localeCompare(right.slug));
        return { homeRelativeRoot, skills };
      })
    ),
  };
}
```

- [ ] **Step 4: Run the exporter tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-export.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit the exporter foundation**

Run:

```bash
git add packages/server/src/runtime/wsl-skill-snapshot.ts packages/server/src/runtime/wsl-skill-export.ts packages/server/src/__tests__/runtime/wsl-skill-export.test.ts
git commit -m "test(server): cover WSL agent skill export"
```

---

### Task 2: Expose The Windows Skill Export Through A Host Command

**Files:**
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`

- [ ] **Step 1: Write the failing workspace command test**

Add this test to `packages/server/src/__tests__/workspace-commands.test.ts`:

```ts
  describe("workspace.wsl.exportAgentSkills", () => {
    it("exports Windows agent-visible skill roots through normal host command dispatch", async () => {
      const homeRoot = join(settingsDir, "fake-home");
      await mkdir(join(homeRoot, ".agents", "skills", "review-skill"), { recursive: true });
      await writeFile(
        join(homeRoot, ".agents", "skills", "review-skill", "SKILL.md"),
        "# Review Skill\n"
      );

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-wsl-export-agent-skills",
          op: "workspace.wsl.exportAgentSkills",
          args: {},
        },
        {
          ...ctx,
          providerRegistry: [
            {
              id: "codex",
              displayName: "Codex",
              badge: "Codex",
              kind: "built_in",
              supportsSkillsMount: true,
              capability: "full",
              capabilities: [],
              install: {
                prerequisites: [],
                manualGuideKeys: [],
                docUrls: { provider: "", prerequisites: {} },
                strategies: {},
              },
              buildCommand: () => ({ argv: ["codex"], env: {}, cwd: homeRoot }),
              configSchema: { parse: (value: unknown) => value } as never,
              defaultConfig: {},
              requiredCommands: ["codex"],
              skillMountDirectories: [join(homeRoot, ".agents", "skills")],
            },
          ] as never,
        }
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        roots: [
          {
            homeRelativeRoot: ".agents/skills",
            skills: [
              {
                slug: "review-skill",
                files: [
                  {
                    relativePath: "SKILL.md",
                    contentBase64: Buffer.from("# Review Skill\n").toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });
```

- [ ] **Step 2: Run the workspace command tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace-commands.test.ts
```

Expected: FAIL with `Unknown operation: workspace.wsl.exportAgentSkills`.

- [ ] **Step 3: Register the host command in `workspace.ts`**

Add these imports near the top of `packages/server/src/commands/workspace.ts`:

```ts
import { exportAgentSkillSnapshot } from "../runtime/wsl-skill-export.js";
```

Register the new host command beside the existing WSL commands:

```ts
registerHostCommand("workspace.wsl.exportAgentSkills", z.object({}), async (_args, ctx) => {
  return exportAgentSkillSnapshot({
    providerRegistry: ctx.providerRegistry.filter(
      (provider) => provider.supportsSkillsMount === true
    ),
  });
});
```

- [ ] **Step 4: Run the exporter and workspace command tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-export.test.ts src/__tests__/workspace-commands.test.ts
```

Expected: PASS with the new workspace command test and the exporter unit tests still green.

- [ ] **Step 5: Commit the host command wiring**

Run:

```bash
git add packages/server/src/commands/workspace.ts packages/server/src/__tests__/workspace-commands.test.ts
git commit -m "feat(server): export Windows agent skills for WSL"
```

---

### Task 3: Mirror Windows Skill Snapshots Into The WSL Home Directory

**Files:**
- Create: `packages/server/src/runtime/wsl-skill-sync.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-skill-sync.test.ts`

- [ ] **Step 1: Write the failing mirror tests**

Create `packages/server/src/__tests__/runtime/wsl-skill-sync.test.ts` with:

```ts
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mirrorAgentSkillSnapshot } from "../../runtime/wsl-skill-sync.js";

describe("wsl skill sync", () => {
  let homeRoot = "";

  afterEach(async () => {
    if (homeRoot) {
      await rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("creates missing skills, overwrites changed files, and deletes skills absent from Windows", async () => {
    homeRoot = await mkdtemp(join(tmpdir(), "wsl-skill-sync-"));
    const sharedRoot = join(homeRoot, ".agents", "skills");
    await mkdir(join(sharedRoot, "stale-skill"), { recursive: true });
    await writeFile(join(sharedRoot, "stale-skill", "SKILL.md"), "# stale\n");
    await mkdir(join(sharedRoot, "review-skill"), { recursive: true });
    await writeFile(join(sharedRoot, "review-skill", "SKILL.md"), "# old\n");

    await mirrorAgentSkillSnapshot({
      homePath: homeRoot,
      snapshot: {
        roots: [
          {
            homeRelativeRoot: ".agents/skills",
            skills: [
              {
                slug: "review-skill",
                files: [
                  {
                    relativePath: "SKILL.md",
                    contentBase64: Buffer.from("# new\n").toString("base64"),
                  },
                  {
                    relativePath: "refs/guide.md",
                    contentBase64: Buffer.from("guide\n").toString("base64"),
                  },
                ],
              },
              {
                slug: "fresh-skill",
                files: [
                  {
                    relativePath: "SKILL.md",
                    contentBase64: Buffer.from("# fresh\n").toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await expect(readFile(join(sharedRoot, "review-skill", "SKILL.md"), "utf8")).resolves.toBe("# new\n");
    await expect(readFile(join(sharedRoot, "review-skill", "refs", "guide.md"), "utf8")).resolves.toBe("guide\n");
    await expect(readFile(join(sharedRoot, "fresh-skill", "SKILL.md"), "utf8")).resolves.toBe("# fresh\n");
    await expect(readFile(join(sharedRoot, "stale-skill", "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("treats an empty Windows root as a delete-all signal for that WSL root", async () => {
    homeRoot = await mkdtemp(join(tmpdir(), "wsl-skill-sync-empty-"));
    const claudeRoot = join(homeRoot, ".claude", "skills");
    await mkdir(join(claudeRoot, "legacy-skill"), { recursive: true });
    await writeFile(join(claudeRoot, "legacy-skill", "SKILL.md"), "# legacy\n");

    await mirrorAgentSkillSnapshot({
      homePath: homeRoot,
      snapshot: {
        roots: [{ homeRelativeRoot: ".claude/skills", skills: [] }],
      },
    });

    await expect(readdir(claudeRoot)).resolves.toEqual([]);
  });

  it("rejects file paths that escape the target skill directory", async () => {
    homeRoot = await mkdtemp(join(tmpdir(), "wsl-skill-sync-safe-"));

    await expect(
      mirrorAgentSkillSnapshot({
        homePath: homeRoot,
        snapshot: {
          roots: [
            {
              homeRelativeRoot: ".agents/skills",
              skills: [
                {
                  slug: "unsafe-skill",
                  files: [
                    {
                      relativePath: "../outside.txt",
                      contentBase64: Buffer.from("boom").toString("base64"),
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: "path_escape",
    });
  });
});
```

- [ ] **Step 2: Run the sync tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-sync.test.ts
```

Expected: FAIL because `wsl-skill-sync.ts` does not exist yet.

- [ ] **Step 3: Implement the WSL mirror writer**

Create `packages/server/src/runtime/wsl-skill-sync.ts` with:

```ts
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { WslAgentSkillExportSnapshot } from "./wsl-skill-snapshot.js";

function assertPathInside(parent: string, candidate: string): void {
  const rel = relative(resolve(parent), resolve(candidate));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw { code: "path_escape", message: `Path escapes target root: ${candidate}` };
  }
}

async function removeMissingSkillDirs(rootPath: string, allowedSlugs: Set<string>): Promise<void> {
  let entries = [];
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || allowedSlugs.has(entry.name)) {
      continue;
    }
    await rm(join(rootPath, entry.name), { recursive: true, force: true });
  }
}

export async function mirrorAgentSkillSnapshot(input: {
  homePath?: string;
  snapshot: WslAgentSkillExportSnapshot;
}): Promise<void> {
  const homePath = input.homePath ?? homedir();

  for (const root of input.snapshot.roots) {
    const targetRoot = join(homePath, root.homeRelativeRoot);
    await mkdir(targetRoot, { recursive: true });
    const allowedSlugs = new Set(root.skills.map((skill) => skill.slug));

    for (const skill of root.skills) {
      const targetSkillDir = join(targetRoot, skill.slug);
      await rm(targetSkillDir, { recursive: true, force: true });
      await mkdir(targetSkillDir, { recursive: true });

      for (const file of skill.files) {
        const targetFile = join(targetSkillDir, file.relativePath);
        assertPathInside(targetSkillDir, targetFile);
        await mkdir(dirname(targetFile), { recursive: true });
        await writeFile(targetFile, Buffer.from(file.contentBase64, "base64"));
      }
    }

    await removeMissingSkillDirs(targetRoot, allowedSlugs);
  }
}
```

- [ ] **Step 4: Run the sync tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-sync.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit the WSL mirror implementation**

Run:

```bash
git add packages/server/src/runtime/wsl-skill-sync.ts packages/server/src/__tests__/runtime/wsl-skill-sync.test.ts
git commit -m "feat(server): mirror Windows agent skills into WSL"
```

---

### Task 4: Wire Skill Sync Into WSL Runtime Startup Before Native Runtime Assembly

**Files:**
- Modify: `packages/server/src/runtime/wsl-entry.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-entry-skill-sync.test.ts`

- [ ] **Step 1: Write the failing startup-order test**

Create `packages/server/src/__tests__/runtime/wsl-entry-skill-sync.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

describe("wsl entry skill sync", () => {
  it("syncs Windows agent skills before creating the WSL native runtime", async () => {
    const calls: string[] = [];

    vi.doMock("../../runtime/wsl-skill-sync.js", () => ({
      mirrorAgentSkillSnapshot: vi.fn(async () => {
        calls.push("sync");
      }),
    }));

    vi.doMock("../../runtime/native-runtime.js", () => ({
      createNativeRuntime: vi.fn(async () => {
        calls.push("createNativeRuntime");
        return {
          id: "wsl:ws-1",
          kind: "native",
          summary: { scope: "workspace", targetRuntime: "wsl", workspaceId: "ws-1" },
          execute: vi.fn(),
          disposeWorkspace: vi.fn(),
          health: vi.fn(async () => ({ ok: true })),
          stop: vi.fn(async () => undefined),
          getContext: vi.fn(() => ({ providerRegistry: [] })),
          getResources: vi.fn(() => ({})),
        };
      }),
    }));

    const { syncWindowsAgentSkillsBeforeRuntime } = await import("../../runtime/wsl-entry.js");
    await syncWindowsAgentSkillsBeforeRuntime({
      requestHostCommand: async () => ({
        roots: [{ homeRelativeRoot: ".agents/skills", skills: [] }],
      }),
    });

    expect(calls).toEqual(["sync"]);
  });

  it("swallows host export failures and lets WSL startup continue", async () => {
    const { syncWindowsAgentSkillsBeforeRuntime } = await import("../../runtime/wsl-entry.js");

    await expect(
      syncWindowsAgentSkillsBeforeRuntime({
        requestHostCommand: async () => {
          throw new Error("relay failed");
        },
      })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the startup-order tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-entry-skill-sync.test.ts
```

Expected: FAIL because `syncWindowsAgentSkillsBeforeRuntime` does not exist yet.

- [ ] **Step 3: Add a testable sync hook to `wsl-entry.ts` and call it before `createNativeRuntime(...)`**

Add these imports near the top of `packages/server/src/runtime/wsl-entry.ts`:

```ts
import type { Result } from "@coder-studio/core";
import { mirrorAgentSkillSnapshot } from "./wsl-skill-sync.js";
import type { WslAgentSkillExportSnapshot } from "./wsl-skill-snapshot.js";
```

Add this helper above `runWslRuntimeEntrypoint()`:

```ts
export async function syncWindowsAgentSkillsBeforeRuntime(input: {
  requestHostCommand: (
    op: string,
    args: unknown
  ) => Promise<WslAgentSkillExportSnapshot>;
}): Promise<void> {
  try {
    const snapshot = await input.requestHostCommand("workspace.wsl.exportAgentSkills", {});
    await mirrorAgentSkillSnapshot({ snapshot });
  } catch (error) {
    console.warn("WSL skill sync failed; continuing startup", error);
  }
}
```

Inside `runWslRuntimeEntrypoint()`, immediately after `const peer = await socketServer.acceptOnce(rpcHandlers);`, insert:

```ts
  await syncWindowsAgentSkillsBeforeRuntime({
    requestHostCommand: async (op, args) => {
      const result = (await peer.request("relayHostCommand", {
        id: `wsl-skill-sync:${bootstrap.runtimeId}`,
        op,
        args,
      })) as Result;

      if (!result.ok) {
        throw result.error;
      }

      return result.data as WslAgentSkillExportSnapshot;
    },
  });
```

Keep this call before `startWslHostApiProxy(...)` and before `createNativeRuntime(...)` so builtin sync, skill health, and session creation all see the synchronized Linux directories.

- [ ] **Step 4: Run the startup-order and WSL runtime tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-entry-skill-sync.test.ts src/__tests__/runtime/wsl-bootstrap.test.ts src/__tests__/runtime/wsl-runtime.test.ts
```

Expected: PASS with the new entrypoint sync test and the existing WSL runtime tests still green.

- [ ] **Step 5: Commit the WSL startup wiring**

Run:

```bash
git add packages/server/src/runtime/wsl-entry.ts packages/server/src/__tests__/runtime/wsl-entry-skill-sync.test.ts
git commit -m "feat(server): sync Windows agent skills on WSL startup"
```

---

### Task 5: Run The Focused Server Verification And Manual WSL Check

**Files:**
- Modify: none
- Test: `packages/server/src/__tests__/runtime/wsl-skill-export.test.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-skill-sync.test.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-entry-skill-sync.test.ts`
- Test: `packages/server/src/__tests__/workspace-commands.test.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-bootstrap.test.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-runtime.test.ts`

- [ ] **Step 1: Run the focused automated verification set**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-skill-export.test.ts src/__tests__/runtime/wsl-skill-sync.test.ts src/__tests__/runtime/wsl-entry-skill-sync.test.ts src/__tests__/workspace-commands.test.ts src/__tests__/runtime/wsl-bootstrap.test.ts src/__tests__/runtime/wsl-runtime.test.ts
```

Expected: PASS across all six files.

- [ ] **Step 2: Run the manual WSL smoke check**

Run the app, then verify this sequence manually:

```text
1. On Windows, add or edit a test skill under %USERPROFILE%\.agents\skills\mirror-check\SKILL.md
2. Open a WSL workspace in Coder Studio
3. In WSL, inspect ~/.agents/skills/mirror-check/SKILL.md and confirm the content matches Windows
4. Delete the Windows skill directory
5. Re-open the WSL workspace and confirm ~/.agents/skills/mirror-check is gone
6. Start a WSL agent session and confirm the skill is visible without any manual copy step
```

Expected: The WSL mirror matches Windows exactly before the agent session starts.

- [ ] **Step 3: Commit verification notes if the implementation added any new inline logging or comments**

Run:

```bash
git status --short
```

Expected: No uncommitted implementation files remain beyond the planned changes.

- [ ] **Step 4: Prepare the branch for handoff**

Run:

```bash
git log --oneline -5
```

Expected: The branch contains the three feature commits from Tasks 1-4 and no unrelated reverts.

