# Agent Automation Skills MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the MVP from `docs/PRD-agent-automation-skills.md`: built-in Coder Studio skills, automatic provider mounting, agent runtime context, `identify`/`capabilities` discovery, and a minimal audit foundation.

**Architecture:** Reuse the existing skill library/mount/health pipeline. Add a built-in skill registry that materializes first-party skills into the state directory, then uses the existing `SkillMountManager` to mount them into provider skill directories. Add an automation metadata layer that backs both WebSocket commands and top-level CLI output, and extend `SessionManager` to inject Coder Studio runtime context into agent terminals.

**Tech Stack:** TypeScript, Vitest, Node.js fs APIs, existing Coder Studio command dispatch, Fastify runtime config, Jotai/React Skills UI.

---

## File Structure

Create these new files:

- `packages/server/src/skills/builtin/registry.ts` - declares built-in skill metadata and markdown content.
- `packages/server/src/skills/builtin/materialize.ts` - writes built-in skill directories and `SKILL.md` files under state.
- `packages/server/src/skills/builtin/sync-manager.ts` - synchronizes built-ins into the skill library and mounts default-enabled skills.
- `packages/server/src/automation/capabilities.ts` - defines automation capability metadata and filtering.
- `packages/server/src/automation/identify.ts` - resolves current runtime context from environment/runtime data.
- `packages/server/src/automation/audit-log.ts` - append-only local audit writer with sanitization.
- `packages/server/src/commands/automation.ts` - WebSocket commands for `automation.identify` and `automation.capabilities`.
- `packages/cli/src/automation-client.ts` - CLI helpers for `identify` and `capabilities` output.
- `packages/server/src/__tests__/skills/builtin-registry.test.ts`
- `packages/server/src/__tests__/skills/builtin-sync-manager.test.ts`
- `packages/server/src/__tests__/automation/identify.test.ts`
- `packages/server/src/__tests__/automation/capabilities.test.ts`
- `packages/server/src/__tests__/automation/audit-log.test.ts`

Modify these existing files:

- `packages/core/src/domain/skill-management.ts` - add `builtin` as a skill source and built-in related fields.
- `packages/core/src/index.ts` - keep skill-management exports available.
- `packages/server/src/storage/repositories/skill-library-repo.ts` - preserve built-in entries and scanned local entries.
- `packages/server/src/skills/mount-manager.ts` - ensure mounted built-in skills follow the same symlink/copy behavior.
- `packages/server/src/commands/skills.ts` - add built-in sync/list/set-enabled commands and expose built-in metadata in library list.
- `packages/server/src/commands/index.ts` - import `automation.ts`.
- `packages/server/src/ws/dispatch.ts` - add optional `builtinSkillSyncMgr`, `automationAuditLog`, and `stateRoot` context dependencies.
- `packages/server/src/server.ts` - instantiate built-in sync manager, sync built-ins at startup, and wire dependencies.
- `packages/server/src/session/manager.ts` - inject `CODER_STUDIO_*` env values into agent terminals.
- `packages/server/src/session/types.ts` if needed for dependency typing.
- `packages/cli/src/parse-args.ts` - add `identify`, `capabilities`, `--json`, and `skills builtin ...` parsing.
- `packages/cli/src/cli.ts` - handle new commands.
- `docs/help/cli.md` - document `identify` and `capabilities`.
- `packages/web/src/features/workspace/actions/use-skills-panel.ts` - carry built-in metadata through UI state.
- `packages/web/src/features/workspace/views/shared/skills-panel.tsx` - show built-in source labels and built-in section or grouping.
- `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx` - cover built-in labels and disabled state.

Implementation notes:

- Store user disablement in `SettingsRepo` under key `skills.builtin.disabledMounts`.
- Store materialized built-in sources under `<stateRoot>/state/skills/builtin/<slug>/SKILL.md`.
- Use TypeScript string constants for built-in skill content instead of relying on runtime copying of source markdown assets.
- MVP auto-mounts `coder-studio-automation` and `coder-studio-review`. It materializes `coder-studio-browser-verification` but does not auto-mount it until browser automation exists.
- Keep Browser, Plugin/status, MCP, and approval UI out of this MVP implementation.

---

### Task 1: Extend Core Skill Types for Built-ins

**Files:**
- Modify: `packages/core/src/domain/skill-management.ts`
- Test: `packages/core/src/domain/skill-management.test.ts`

- [ ] **Step 1: Write the failing type/runtime test**

Add a focused test in `packages/core/src/domain/skill-management.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SKILL_LIBRARY_SOURCES } from "./skill-management";

describe("skill-management", () => {
  it("includes builtin as a supported skill library source", () => {
    expect(SKILL_LIBRARY_SOURCES).toContain("builtin");
  });
});
```

If the file already has a `describe("skill-management", ...)`, add only the `it(...)` block and import `SKILL_LIBRARY_SOURCES`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm vitest run packages/core/src/domain/skill-management.test.ts
```

Expected: FAIL because `SKILL_LIBRARY_SOURCES` is not exported or does not contain `builtin`.

- [ ] **Step 3: Implement the core type change**

Update `packages/core/src/domain/skill-management.ts`:

```ts
export const SKILL_LIBRARY_SOURCES = ["skillhub", "local", "builtin"] as const;
type SkillLibrarySource = (typeof SKILL_LIBRARY_SOURCES)[number];

export interface SkillLibraryEntry {
  slug: string;
  displayName: string;
  description?: string;
  version: string;
  source: SkillLibrarySource;
  libraryPath: string;
  installState: SkillInstallState;
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  builtin?: {
    defaultEnabled: boolean;
    autoMount: boolean;
  };
}
```

Keep the existing constants and interfaces intact; only replace the hardcoded `source: "skillhub" | "local"` union and add the optional `builtin` metadata.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
pnpm vitest run packages/core/src/domain/skill-management.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/skill-management.ts packages/core/src/domain/skill-management.test.ts
git commit -m "feat: add builtin skill source type"
```

---

### Task 2: Add Built-in Skill Registry and Materialization

**Files:**
- Create: `packages/server/src/skills/builtin/registry.ts`
- Create: `packages/server/src/skills/builtin/materialize.ts`
- Test: `packages/server/src/__tests__/skills/builtin-registry.test.ts`

- [ ] **Step 1: Write the failing registry/materialization tests**

Create `packages/server/src/__tests__/skills/builtin-registry.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_SKILLS } from "../../skills/builtin/registry.js";
import { materializeBuiltinSkills } from "../../skills/builtin/materialize.js";

describe("builtin skills", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("declares the MVP built-in skills with stable defaults", () => {
    expect(BUILTIN_SKILLS.map((skill) => skill.slug)).toEqual([
      "coder-studio-automation",
      "coder-studio-browser-verification",
      "coder-studio-review",
    ]);
    expect(BUILTIN_SKILLS.find((skill) => skill.slug === "coder-studio-automation")).toMatchObject({
      defaultEnabled: true,
      autoMountInMvp: true,
    });
    expect(
      BUILTIN_SKILLS.find((skill) => skill.slug === "coder-studio-browser-verification")
    ).toMatchObject({
      defaultEnabled: true,
      autoMountInMvp: false,
    });
  });

  it("materializes built-in SKILL.md files into the state directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-skills-"));

    const entries = await materializeBuiltinSkills({
      builtinRoot: tempDir,
      now: () => 1234,
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      source: "builtin",
      installState: "installed",
      installedAt: 1234,
      updatedAt: 1234,
    });

    const automation = entries.find((entry) => entry.slug === "coder-studio-automation");
    expect(automation).toBeDefined();
    expect(await readFile(join(automation!.libraryPath, "SKILL.md"), "utf8")).toContain(
      "coder-studio identify --json"
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/builtin-registry.test.ts
```

Expected: FAIL because `skills/builtin/registry.js` and `materialize.js` do not exist.

- [ ] **Step 3: Implement `registry.ts`**

Create `packages/server/src/skills/builtin/registry.ts`:

```ts
export interface BuiltinSkillDefinition {
  slug: string;
  displayName: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  autoMountInMvp: boolean;
  content: string;
}

const AUTOMATION_SKILL = `---
name: coder-studio-automation
description: Use when running inside Coder Studio and you need workspace, session, terminal, Git, or event automation.
---

# Coder Studio Automation

When CODER_STUDIO=1 is present:

1. Run \`coder-studio identify --json\` to inspect current context.
2. Run \`coder-studio capabilities --json\` to discover supported commands.
3. Prefer commands with \`--json\`.
4. Use current workspace and session IDs from identify instead of guessing.
5. Do not run destructive commands unless the user explicitly asked.
6. If a command returns approval_required, explain what approval is needed and wait.
`;

const BROWSER_VERIFICATION_SKILL = `---
name: coder-studio-browser-verification
description: Use after frontend, UI, CSS, route, form, or browser-visible changes to verify the app in Coder Studio's browser automation surface.
---

# Browser Verification

For browser-visible changes:

1. Use \`coder-studio identify --json\`.
2. Use \`coder-studio capabilities --json\` and find browser commands.
3. Start the dev server in a terminal when needed.
4. Open the local URL in a Coder Studio browser surface.
5. Wait for the expected text or selector.
6. Capture a screenshot.
7. Read console errors.
8. Report visible issues and fix them before final response.

If browser capabilities are not available, say so and use the best available local verification.
`;

const REVIEW_SKILL = `---
name: coder-studio-review
description: Use before finishing a coding task in Coder Studio to inspect Git changes, tests, and residual risk.
---

# Coder Studio Review

Before final response after code edits:

1. Run \`coder-studio identify --json\`.
2. Use capabilities to find Git and terminal commands.
3. Inspect Git status and diff.
4. Run relevant tests when practical.
5. Report files changed, verification run, and any remaining risk.
`;

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  {
    slug: "coder-studio-automation",
    displayName: "Coder Studio Automation",
    description: "Teach agents to identify Coder Studio context and discover automation commands.",
    version: "1.0.0",
    defaultEnabled: true,
    autoMountInMvp: true,
    content: AUTOMATION_SKILL,
  },
  {
    slug: "coder-studio-browser-verification",
    displayName: "Coder Studio Browser Verification",
    description: "Teach agents to verify browser-visible changes through Coder Studio automation.",
    version: "1.0.0",
    defaultEnabled: true,
    autoMountInMvp: false,
    content: BROWSER_VERIFICATION_SKILL,
  },
  {
    slug: "coder-studio-review",
    displayName: "Coder Studio Review",
    description: "Teach agents to review Git changes, tests, and residual risk before finishing.",
    version: "1.0.0",
    defaultEnabled: true,
    autoMountInMvp: true,
    content: REVIEW_SKILL,
  },
];
```

- [ ] **Step 4: Implement `materialize.ts`**

Create `packages/server/src/skills/builtin/materialize.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillLibraryEntry } from "@coder-studio/core";
import { BUILTIN_SKILLS } from "./registry.js";

export interface MaterializeBuiltinSkillsInput {
  builtinRoot: string;
  now?: () => number;
}

export async function materializeBuiltinSkills(
  input: MaterializeBuiltinSkillsInput
): Promise<SkillLibraryEntry[]> {
  const now = input.now?.() ?? Date.now();
  const entries: SkillLibraryEntry[] = [];

  for (const skill of BUILTIN_SKILLS) {
    const libraryPath = join(input.builtinRoot, skill.slug);
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), skill.content.trimEnd() + "\n", "utf8");
    entries.push({
      slug: skill.slug,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      source: "builtin",
      libraryPath,
      installState: "installed",
      installedAt: now,
      updatedAt: now,
      builtin: {
        defaultEnabled: skill.defaultEnabled,
        autoMount: skill.autoMountInMvp,
      },
    });
  }

  return entries;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/builtin-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/skills/builtin packages/server/src/__tests__/skills/builtin-registry.test.ts
git commit -m "feat: add built-in skill registry"
```

---

### Task 3: Sync Built-ins into Library and Auto-mount Defaults

**Files:**
- Create: `packages/server/src/skills/builtin/sync-manager.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/__tests__/skills/builtin-sync-manager.test.ts`

- [ ] **Step 1: Write the failing sync-manager tests**

Create `packages/server/src/__tests__/skills/builtin-sync-manager.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsRepo } from "../../storage/repositories/settings-repo.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import { BuiltinSkillSyncManager } from "../../skills/builtin/sync-manager.js";

function provider(id: string, skillDir?: string): ProviderDefinition {
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
    buildCommand: () => ({ argv: [id], env: {}, cwd: "/tmp" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: [id],
    skillMountDirectories: skillDir ? [skillDir] : undefined,
  };
}

describe("BuiltinSkillSyncManager", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("syncs built-ins into the library and mounts MVP defaults", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-sync-"));
    const skillDir = join(tempDir, "codex-skills");
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => [provider("codex", skillDir)],
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(result.libraryEntries.map((entry) => entry.slug)).toEqual([
      "coder-studio-automation",
      "coder-studio-browser-verification",
      "coder-studio-review",
    ]);
    expect(mountRepo.get("codex", "coder-studio-automation")).toMatchObject({
      enabled: true,
      status: "mounted",
    });
    expect(mountRepo.get("codex", "coder-studio-review")).toMatchObject({
      enabled: true,
      status: "mounted",
    });
    expect(mountRepo.get("codex", "coder-studio-browser-verification")).toBeUndefined();
  });

  it("does not re-mount a user-disabled built-in skill", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-disabled-"));
    const skillDir = join(tempDir, "codex-skills");
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    settingsRepo.set("skills.builtin.disabledMounts", {
      "codex:coder-studio-review": true,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => [provider("codex", skillDir)],
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      settingsRepo,
      now: () => 1000,
    });

    await manager.sync();

    expect(mountRepo.get("codex", "coder-studio-automation")).toBeDefined();
    expect(mountRepo.get("codex", "coder-studio-review")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/builtin-sync-manager.test.ts
```

Expected: FAIL because `BuiltinSkillSyncManager` does not exist.

- [ ] **Step 3: Implement `BuiltinSkillSyncManager`**

Create `packages/server/src/skills/builtin/sync-manager.ts`:

```ts
import { copyFile, mkdir, readdir, readlink, rm, symlink, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProviderDefinition, SkillLibraryEntry, SkillMountRelation } from "@coder-studio/core";
import type { SettingsRepo } from "../../storage/repositories/settings-repo.js";
import type { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import { materializeBuiltinSkills } from "./materialize.js";

const DISABLED_MOUNTS_SETTING_KEY = "skills.builtin.disabledMounts";

export interface BuiltinSkillSyncManagerDeps {
  builtinRoot: string;
  getProviderRegistry: () => ProviderDefinition[];
  skillLibraryRepo: SkillLibraryRepo;
  skillMountRepo: SkillMountRepo;
  settingsRepo: SettingsRepo;
  now?: () => number;
}

export interface BuiltinSkillSyncResult {
  libraryEntries: SkillLibraryEntry[];
  mounted: SkillMountRelation[];
  skipped: Array<{ providerId: string; skillSlug: string; reason: string }>;
}

export class BuiltinSkillSyncManager {
  constructor(private readonly deps: BuiltinSkillSyncManagerDeps) {}

  async sync(): Promise<BuiltinSkillSyncResult> {
    const entries = await materializeBuiltinSkills({
      builtinRoot: this.deps.builtinRoot,
      now: this.deps.now,
    });
    for (const entry of entries) {
      this.deps.skillLibraryRepo.set(entry);
    }

    const disabled = this.readDisabledMounts();
    const mounted: SkillMountRelation[] = [];
    const skipped: BuiltinSkillSyncResult["skipped"] = [];

    for (const provider of this.deps.getProviderRegistry()) {
      const skillDir = provider.skillMountDirectories?.[0];
      if (!skillDir) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.builtin?.autoMount) {
          skipped.push({ providerId: provider.id, skillSlug: entry.slug, reason: "not_mvp_auto" });
          continue;
        }

        if (disabled[disabledKey(provider.id, entry.slug)]) {
          skipped.push({ providerId: provider.id, skillSlug: entry.slug, reason: "disabled" });
          continue;
        }

        const relation = await this.mountBuiltin(provider.id, skillDir, entry);
        this.deps.skillMountRepo.upsert(relation);
        mounted.push(relation);
      }
    }

    return { libraryEntries: entries, mounted, skipped };
  }

  setMountEnabled(providerId: string, skillSlug: string, enabled: boolean): void {
    const disabled = this.readDisabledMounts();
    const key = disabledKey(providerId, skillSlug);
    if (enabled) {
      delete disabled[key];
    } else {
      disabled[key] = true;
    }
    this.deps.settingsRepo.set(DISABLED_MOUNTS_SETTING_KEY, disabled);
  }

  isMountDisabled(providerId: string, skillSlug: string): boolean {
    return Boolean(this.readDisabledMounts()[disabledKey(providerId, skillSlug)]);
  }

  private readDisabledMounts(): Record<string, true> {
    const raw = this.deps.settingsRepo.get<Record<string, unknown>>(DISABLED_MOUNTS_SETTING_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(raw).filter(([, value]) => value === true)
    ) as Record<string, true>;
  }

  private async mountBuiltin(
    providerId: string,
    skillDir: string,
    entry: SkillLibraryEntry
  ): Promise<SkillMountRelation> {
    const targetPath = join(skillDir, entry.slug);
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { recursive: true, force: true });

    let mountModeResolved: SkillMountRelation["mountModeResolved"] = "symlink";
    try {
      await symlink(entry.libraryPath, targetPath);
    } catch {
      mountModeResolved = "copy";
      await copyRecursively(entry.libraryPath, targetPath);
    }

    return {
      providerId,
      skillSlug: entry.slug,
      enabled: true,
      sourcePath: entry.libraryPath,
      targetPath,
      mountModeResolved,
      status: "mounted",
      lastSyncedAt: this.deps.now?.() ?? Date.now(),
    };
  }
}

function disabledKey(providerId: string, skillSlug: string): string {
  return `${providerId}:${skillSlug}`;
}

async function copyRecursively(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyRecursively(from, to);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(from);
      await symlink(linkTarget, to);
    } else {
      await copyFile(from, to);
    }
  }
}
```

Remove unused imports after implementation; if `unlink` is unused, do not keep it.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/builtin-sync-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire manager into server context**

Modify `packages/server/src/ws/dispatch.ts`:

```ts
import type { BuiltinSkillSyncManager } from "../skills/builtin/sync-manager.js";
```

Add to `CommandContext`:

```ts
builtinSkillSyncMgr?: BuiltinSkillSyncManager;
stateRoot?: string;
```

Modify `packages/server/src/server.ts` imports:

```ts
import { BuiltinSkillSyncManager } from "./skills/builtin/sync-manager.js";
```

After `skillHealthMgr` is created, instantiate:

```ts
const builtinSkillSyncMgr = new BuiltinSkillSyncManager({
  builtinRoot: join(stateRoot, "state", "skills", "builtin"),
  getProviderRegistry: () => activeProviderRegistry,
  skillLibraryRepo,
  skillMountRepo,
  settingsRepo,
});
await builtinSkillSyncMgr.sync();
```

Add `builtinSkillSyncMgr` and `stateRoot` to `commandContext`.

- [ ] **Step 6: Run targeted server tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/builtin-sync-manager.test.ts src/__tests__/skills/commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/skills/builtin/sync-manager.ts packages/server/src/__tests__/skills/builtin-sync-manager.test.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts
git commit -m "feat: sync built-in skills"
```

---

### Task 4: Expose Built-in Skill Commands and Library Metadata

**Files:**
- Modify: `packages/server/src/commands/skills.ts`
- Test: `packages/server/src/__tests__/skills/commands.test.ts`

- [ ] **Step 1: Write failing command tests**

Add tests to `packages/server/src/__tests__/skills/commands.test.ts`:

```ts
it("returns builtin library metadata", async () => {
  const ctx = createBaseContext({
    skillLibraryRepo: {
      list: vi.fn(() => [
        {
          slug: "coder-studio-automation",
          displayName: "Coder Studio Automation",
          description: "Teach agents",
          version: "1.0.0",
          source: "builtin",
          libraryPath: "/skills/builtin/coder-studio-automation",
          installState: "installed",
          installedAt: 1,
          updatedAt: 2,
          builtin: { defaultEnabled: true, autoMount: true },
        },
      ]),
    } as never,
    skillMountRepo: {
      listBySkillSlug: vi.fn(() => []),
    } as never,
    skillsHubClient: {} as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "skills-library-builtin-1",
      op: "skills.library.list",
      args: {},
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toEqual([
    expect.objectContaining({
      slug: "coder-studio-automation",
      source: "builtin",
      builtin: { defaultEnabled: true, autoMount: true },
    }),
  ]);
});

it("syncs builtin skills through command dispatch", async () => {
  const sync = vi.fn(async () => ({
    libraryEntries: [],
    mounted: [],
    skipped: [],
  }));
  const ctx = createBaseContext({
    builtinSkillSyncMgr: { sync } as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "skills-builtin-sync-1",
      op: "skills.builtin.sync",
      args: {},
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(sync).toHaveBeenCalledTimes(1);
});

it("persists builtin mount disablement through command dispatch", async () => {
  const setMountEnabled = vi.fn();
  const sync = vi.fn(async () => ({
    libraryEntries: [],
    mounted: [],
    skipped: [],
  }));
  const ctx = createBaseContext({
    builtinSkillSyncMgr: { setMountEnabled, sync } as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "skills-builtin-set-enabled-1",
      op: "skills.builtin.setMountEnabled",
      args: {
        providerId: "codex",
        skillSlug: "coder-studio-review",
        enabled: false,
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(setMountEnabled).toHaveBeenCalledWith("codex", "coder-studio-review", false);
  expect(sync).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/commands.test.ts
```

Expected: FAIL for missing `skills.builtin.sync` and `skills.builtin.setMountEnabled` command handlers.

- [ ] **Step 3: Add command handlers**

Modify `packages/server/src/commands/skills.ts`:

```ts
function requireBuiltinSkillSyncSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  builtinSkillSyncMgr: NonNullable<CommandContext["builtinSkillSyncMgr"]>;
} {
  if (!ctx.builtinSkillSyncMgr) {
    throw {
      code: "builtin_skills_unavailable",
      message: "Built-in skill sync is not configured",
    };
  }
}
```

Add handlers:

```ts
registerCommand("skills.builtin.sync", z.object({}), async (_args, ctx) => {
  requireBuiltinSkillSyncSupport(ctx);
  return ctx.builtinSkillSyncMgr.sync();
});

registerCommand(
  "skills.builtin.setMountEnabled",
  z.object({
    providerId: z.string().trim().min(1),
    skillSlug: z.string().trim().min(1),
    enabled: z.boolean(),
  }),
  async (args, ctx) => {
    requireBuiltinSkillSyncSupport(ctx);
    ctx.builtinSkillSyncMgr.setMountEnabled(args.providerId, args.skillSlug, args.enabled);
    return ctx.builtinSkillSyncMgr.sync();
  }
);
```

No extra implementation is needed for library metadata if `skills.library.list` returns `...entry`.

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/skills/commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/skills.ts packages/server/src/__tests__/skills/commands.test.ts
git commit -m "feat: add built-in skill commands"
```

---

### Task 5: Inject Agent Runtime Context into Session Terminals

**Files:**
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/session/types.ts` if needed
- Test: `packages/server/src/__tests__/session-commands.test.ts`

- [ ] **Step 1: Write the failing session env test**

Add a test in `packages/server/src/__tests__/session-commands.test.ts` near the existing session create tests:

```ts
it("injects Coder Studio runtime context into agent terminal env", async () => {
  const testDir = join(tmpdir(), `coder-studio-session-env-${Date.now()}`);
  mkdirSync(join(testDir, ".git"), { recursive: true });
  writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

  const createdSpecs: Array<{ env?: Record<string, string> }> = [];
  terminalMgrStub = {
    create: (spec: { env?: Record<string, string> }) => {
      createdSpecs.push(spec);
      return { id: "terminal-env-1" };
    },
    kill: async () => {},
    close: async () => {},
  } as unknown as TerminalManager;
  sessionMgr = new SessionManager({
    terminalMgr: terminalMgrStub,
    eventBus,
    db: sessionDbStub,
    broadcaster,
    providerRegistry: [],
    providerConfigRepo: createProviderConfigRepo(join(stateDir, "provider-configs-env.json")),
    runtimeContext: {
      apiUrl: "http://127.0.0.1:4173",
    },
  });
  ctx.sessionMgr = sessionMgr;
  ctx.providerRegistry = providerRegistry as ProviderDefinition[];
  ctx.providerRuntimeDeps = {
    commandExists: async (command: string) => command === "claude",
  };

  try {
    const openResult = await dispatch(
      {
        kind: "command",
        id: "workspace-env",
        op: "workspace.open",
        args: { path: testDir },
      },
      ctx
    );

    expect(openResult.ok).toBe(true);

    const result = await dispatch(
      {
        kind: "command",
        id: "session-env",
        op: "session.create",
        args: {
          workspaceId: openResult.data!.id,
          providerId: "claude",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(createdSpecs[0]?.env).toMatchObject({
      CODER_STUDIO: "1",
      CODER_STUDIO_WORKSPACE_ID: openResult.data!.id,
      CODER_STUDIO_SESSION_ID: expect.stringMatching(/^sess_/),
      CODER_STUDIO_PROVIDER_ID: "claude",
      CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
    });
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/session-commands.test.ts
```

Expected: FAIL because `runtimeContext` is not accepted by `SessionManagerDeps` or env values are missing.

- [ ] **Step 3: Extend SessionManager deps and env injection**

Modify `packages/server/src/session/manager.ts`:

```ts
export interface SessionRuntimeContext {
  apiUrl?: string;
}

export interface SessionManagerDeps {
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  db: SessionDatabase;
  broadcaster: Broadcaster;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  runtimeContext?: SessionRuntimeContext;
  logger?: SessionLogger;
}
```

In `create`, update terminal env:

```ts
env: {
  ...cmd.env,
  CODER_STUDIO: "1",
  CODER_STUDIO_WORKSPACE_ID: req.workspaceId,
  CODER_STUDIO_SESSION_ID: sessionId,
  CODER_STUDIO_PROVIDER_ID: req.providerId,
  ...(this.deps.runtimeContext?.apiUrl
    ? { CODER_STUDIO_API_URL: this.deps.runtimeContext.apiUrl }
    : {}),
},
```

Do not inject `CODER_STUDIO_TERMINAL_ID` here because the terminal id is only known after `terminalMgr.create()`. Keep the PRD's terminal id variable for a later implementation that can safely update env through PTY launch changes.

- [ ] **Step 4: Wire runtimeContext in server**

Modify `packages/server/src/server.ts` where `SessionManager` is created:

```ts
runtimeContext: {
  apiUrl: `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`,
},
```

If there is an existing URL helper, prefer it; otherwise use the explicit expression above.

- [ ] **Step 5: Run the test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/session-commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/session/manager.ts packages/server/src/server.ts packages/server/src/__tests__/session-commands.test.ts
git commit -m "feat: inject coder studio agent context"
```

---

### Task 6: Add Automation Identify and Capabilities Metadata

**Files:**
- Create: `packages/server/src/automation/identify.ts`
- Create: `packages/server/src/automation/capabilities.ts`
- Create: `packages/server/src/commands/automation.ts`
- Modify: `packages/server/src/commands/index.ts`
- Test: `packages/server/src/__tests__/automation/identify.test.ts`
- Test: `packages/server/src/__tests__/automation/capabilities.test.ts`

- [ ] **Step 1: Write failing automation tests**

Create `packages/server/src/__tests__/automation/identify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildIdentifyResult } from "../../automation/identify.js";

describe("automation identify", () => {
  it("returns outside-Coder-Studio when env marker is absent", () => {
    expect(buildIdentifyResult({ env: {} })).toEqual({ insideCoderStudio: false });
  });

  it("returns runtime context from env", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_WORKSPACE_ID: "ws-1",
          CODER_STUDIO_SESSION_ID: "sess-1",
          CODER_STUDIO_PROVIDER_ID: "codex",
          CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
        },
        cwd: "/repo",
      })
    ).toEqual({
      insideCoderStudio: true,
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerId: "codex",
      cwd: "/repo",
      apiUrl: "http://127.0.0.1:4173",
      permissions: ["workspace:read", "session:read", "terminal:read", "git:read"],
    });
  });
});
```

Create `packages/server/src/__tests__/automation/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listAutomationCapabilities } from "../../automation/capabilities.js";

describe("automation capabilities", () => {
  it("lists MVP read capabilities with command examples", () => {
    const capabilities = listAutomationCapabilities({
      permissions: ["workspace:read", "session:read", "terminal:read", "git:read"],
    });

    expect(capabilities.map((capability) => capability.name)).toContain("git.status");
    expect(capabilities.find((capability) => capability.name === "git.status")).toMatchObject({
      cli: "coder-studio git status",
      riskLevel: "read",
      permissions: ["git:read"],
      available: true,
    });
  });

  it("filters capabilities by permissions", () => {
    const capabilities = listAutomationCapabilities({
      permissions: ["workspace:read"],
    });

    expect(capabilities.map((capability) => capability.name)).toContain("workspace.list");
    expect(capabilities.map((capability) => capability.name)).not.toContain("git.status");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/automation/identify.test.ts src/__tests__/automation/capabilities.test.ts
```

Expected: FAIL because automation modules do not exist.

- [ ] **Step 3: Implement identify**

Create `packages/server/src/automation/identify.ts`:

```ts
export interface IdentifyInput {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cwd?: string;
}

export interface IdentifyResult {
  insideCoderStudio: boolean;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  providerId?: string;
  cwd?: string;
  apiUrl?: string;
  permissions?: string[];
}

const DEFAULT_AGENT_PERMISSIONS = ["workspace:read", "session:read", "terminal:read", "git:read"];

export function buildIdentifyResult(input: IdentifyInput = {}): IdentifyResult {
  const env = input.env ?? process.env;
  if (env.CODER_STUDIO !== "1") {
    return { insideCoderStudio: false };
  }

  return {
    insideCoderStudio: true,
    workspaceId: env.CODER_STUDIO_WORKSPACE_ID,
    sessionId: env.CODER_STUDIO_SESSION_ID,
    terminalId: env.CODER_STUDIO_TERMINAL_ID,
    providerId: env.CODER_STUDIO_PROVIDER_ID,
    cwd: input.cwd ?? process.cwd(),
    apiUrl: env.CODER_STUDIO_API_URL,
    permissions: DEFAULT_AGENT_PERMISSIONS,
  };
}
```

- [ ] **Step 4: Implement capabilities**

Create `packages/server/src/automation/capabilities.ts`:

```ts
export type AutomationRiskLevel = "read" | "write" | "dangerous";

export interface AutomationCapability {
  name: string;
  cli: string;
  description: string;
  inputSchema: Record<string, string>;
  output: string;
  permissions: string[];
  riskLevel: AutomationRiskLevel;
  examples: string[];
  available: boolean;
}

const MVP_CAPABILITIES: AutomationCapability[] = [
  {
    name: "workspace.list",
    cli: "coder-studio workspace list",
    description: "List known workspaces.",
    inputSchema: {},
    output: "Workspace summaries as JSON.",
    permissions: ["workspace:read"],
    riskLevel: "read",
    examples: ["coder-studio workspace list --json"],
    available: true,
  },
  {
    name: "session.list",
    cli: "coder-studio session list",
    description: "List sessions visible to the current caller.",
    inputSchema: { workspaceId: "string optional" },
    output: "Session summaries as JSON.",
    permissions: ["session:read"],
    riskLevel: "read",
    examples: ["coder-studio session list --workspace ws_123 --json"],
    available: true,
  },
  {
    name: "terminal.read",
    cli: "coder-studio terminal read",
    description: "Read terminal output tail.",
    inputSchema: { terminalId: "string", bytes: "number optional" },
    output: "Terminal text tail.",
    permissions: ["terminal:read"],
    riskLevel: "read",
    examples: ["coder-studio terminal read --terminal term_123 --json"],
    available: true,
  },
  {
    name: "git.status",
    cli: "coder-studio git status",
    description: "Read Git status for a workspace.",
    inputSchema: { workspaceId: "string" },
    output: "Git status summary as JSON.",
    permissions: ["git:read"],
    riskLevel: "read",
    examples: ["coder-studio git status --workspace ws_123 --json"],
    available: true,
  },
  {
    name: "git.diff",
    cli: "coder-studio git diff",
    description: "Read Git diff for a workspace.",
    inputSchema: { workspaceId: "string", path: "string optional" },
    output: "Git diff text or structured diff data.",
    permissions: ["git:read"],
    riskLevel: "read",
    examples: ["coder-studio git diff --workspace ws_123 --json"],
    available: true,
  },
];

export function listAutomationCapabilities(input: { permissions: string[] }): AutomationCapability[] {
  const allowed = new Set(input.permissions);
  return MVP_CAPABILITIES.filter((capability) =>
    capability.permissions.every((permission) => allowed.has(permission))
  );
}
```

- [ ] **Step 5: Add WebSocket commands**

Create `packages/server/src/commands/automation.ts`:

```ts
import { z } from "zod";
import { listAutomationCapabilities } from "../automation/capabilities.js";
import { buildIdentifyResult } from "../automation/identify.js";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("automation.identify", z.object({}), async () => {
  return buildIdentifyResult();
});

registerCommand(
  "automation.capabilities",
  z.object({
    permissions: z.array(z.string()).optional(),
  }),
  async (args) => {
    return {
      version: 1,
      commands: listAutomationCapabilities({
        permissions: args.permissions ?? ["workspace:read", "session:read", "terminal:read", "git:read"],
      }),
    };
  }
);
```

Modify `packages/server/src/commands/index.ts`:

```ts
import "./automation.js";
```

- [ ] **Step 6: Run tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/automation/identify.test.ts src/__tests__/automation/capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/automation packages/server/src/commands/automation.ts packages/server/src/commands/index.ts packages/server/src/__tests__/automation
git commit -m "feat: add automation discovery metadata"
```

---

### Task 7: Add CLI `identify` and `capabilities`

**Files:**
- Create: `packages/cli/src/automation-client.ts`
- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/src/bin.test.ts`

- [ ] **Step 1: Write failing CLI tests**

In `packages/cli/src/bin.test.ts`, add imports/mocks for automation helpers:

```ts
const {
  printCapabilities,
  printIdentify,
  // existing hoisted mocks...
} = vi.hoisted(() => ({
  printCapabilities: vi.fn(),
  printIdentify: vi.fn(),
  // existing mocks...
}));

vi.mock("./automation-client.js", () => ({
  printCapabilities,
  printIdentify,
}));
```

Add tests:

```ts
it("parses identify command with --json", () => {
  expect(parseArgs(["identify", "--json"])).toEqual({
    command: "identify",
    json: true,
  });
});

it("prints identify output", async () => {
  await main(["identify", "--json"]);
  expect(printIdentify).toHaveBeenCalledWith({ json: true });
});

it("prints capabilities output", async () => {
  await main(["capabilities", "--json"]);
  expect(printCapabilities).toHaveBeenCalledWith({ json: true });
});
```

Adjust the existing hoisted mock block carefully rather than creating a second conflicting `vi.hoisted`.

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- src/bin.test.ts
```

Expected: FAIL because parser and CLI do not know `identify` or `capabilities`.

- [ ] **Step 3: Implement `automation-client.ts`**

Create `packages/cli/src/automation-client.ts`:

```ts
interface PrintOptions {
  json?: boolean;
}

function defaultPermissions(): string[] {
  return ["workspace:read", "session:read", "terminal:read", "git:read"];
}

export function printIdentify(options: PrintOptions = {}): void {
  const insideCoderStudio = process.env.CODER_STUDIO === "1";
  const result = insideCoderStudio
    ? {
        insideCoderStudio: true,
        workspaceId: process.env.CODER_STUDIO_WORKSPACE_ID,
        sessionId: process.env.CODER_STUDIO_SESSION_ID,
        terminalId: process.env.CODER_STUDIO_TERMINAL_ID,
        providerId: process.env.CODER_STUDIO_PROVIDER_ID,
        cwd: process.cwd(),
        apiUrl: process.env.CODER_STUDIO_API_URL,
        permissions: defaultPermissions(),
      }
    : { insideCoderStudio: false };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.insideCoderStudio ? "Inside Coder Studio" : "Not running inside Coder Studio");
}

export function printCapabilities(options: PrintOptions = {}): void {
  const result = {
    version: 1,
    commands: [
      {
        name: "workspace.list",
        cli: "coder-studio workspace list",
        description: "List known workspaces.",
        inputSchema: {},
        output: "Workspace summaries as JSON.",
        permissions: ["workspace:read"],
        riskLevel: "read",
        examples: ["coder-studio workspace list --json"],
        available: true,
      },
      {
        name: "git.status",
        cli: "coder-studio git status",
        description: "Read Git status for a workspace.",
        inputSchema: { workspaceId: "string" },
        output: "Git status summary as JSON.",
        permissions: ["git:read"],
        riskLevel: "read",
        examples: ["coder-studio git status --workspace ws_123 --json"],
        available: true,
      },
    ],
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.commands.map((command) => `${command.name}: ${command.cli}`).join("\n"));
}
```

This duplicates a minimal MVP capabilities subset in the CLI package because the published CLI bundle cannot import server source directly without affecting bundling. A later refactor can move shared metadata into `@coder-studio/core`.

- [ ] **Step 4: Extend parser**

Modify `packages/cli/src/parse-args.ts`:

```ts
type CliCommand =
  | "serve"
  | "open"
  | "config"
  | "stop"
  | "status"
  | "logs"
  | "help"
  | "version"
  | "auth"
  | "identify"
  | "capabilities";
```

Add to `CliArgs`:

```ts
json?: boolean;
```

Add cases:

```ts
case "identify":
case "capabilities":
  setCommand(args, arg);
  break;

case "--json":
  if (getActiveCommand(args) !== "identify" && getActiveCommand(args) !== "capabilities") {
    throwUnknownOption(arg);
  }
  args.json = true;
  break;
```

When `setCommand` switches away from `identify` or `capabilities`, it can leave `json` harmlessly or delete it for stricter parsing. Prefer deleting it unless the active command supports JSON.

- [ ] **Step 5: Extend CLI main**

Modify `packages/cli/src/cli.ts` imports:

```ts
import { printCapabilities, printIdentify } from "./automation-client.js";
```

In `showHelp`, add commands:

```text
  identify      Print Coder Studio agent runtime context
  capabilities  Print agent-facing automation capabilities
```

In `main` after version/help handling:

```ts
if (args.command === "identify") {
  printIdentify({ json: args.json });
  return;
}

if (args.command === "capabilities") {
  printCapabilities({ json: args.json });
  return;
}
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- src/bin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/automation-client.ts packages/cli/src/parse-args.ts packages/cli/src/cli.ts packages/cli/src/bin.test.ts
git commit -m "feat: add automation discovery cli commands"
```

---

### Task 8: Add Minimal Automation Audit Log

**Files:**
- Create: `packages/server/src/automation/audit-log.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/__tests__/automation/audit-log.test.ts`

- [ ] **Step 1: Write failing audit log tests**

Create `packages/server/src/__tests__/automation/audit-log.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationAuditLog } from "../../automation/audit-log.js";

describe("AutomationAuditLog", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes sanitized JSONL audit records", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-audit-"));
    const log = new AutomationAuditLog({
      filePath: join(tempDir, "automation.jsonl"),
      now: () => 1234,
    });

    await log.append({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerId: "codex",
      commandName: "terminal.send",
      riskLevel: "write",
      decision: "allowed",
      success: true,
      args: {
        text: "secret-token",
        token: "abc",
      },
    });

    const lines = (await readFile(join(tempDir, "automation.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      timestamp: 1234,
      workspaceId: "ws-1",
      commandName: "terminal.send",
      args: {
        text: "secret-token",
        token: "[redacted]",
      },
    });
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/automation/audit-log.test.ts
```

Expected: FAIL because `audit-log.ts` does not exist.

- [ ] **Step 3: Implement audit log**

Create `packages/server/src/automation/audit-log.ts`:

```ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AutomationAuditRecordInput {
  workspaceId?: string;
  sessionId?: string;
  providerId?: string;
  commandName: string;
  riskLevel: "read" | "write" | "dangerous";
  decision: "allowed" | "denied" | "approval_required";
  success: boolean;
  args?: Record<string, unknown>;
}

export interface AutomationAuditLogDeps {
  filePath: string;
  now?: () => number;
}

export class AutomationAuditLog {
  constructor(private readonly deps: AutomationAuditLogDeps) {}

  async append(input: AutomationAuditRecordInput): Promise<void> {
    await mkdir(dirname(this.deps.filePath), { recursive: true });
    const record = {
      timestamp: this.deps.now?.() ?? Date.now(),
      ...input,
      args: sanitizeArgs(input.args ?? {}),
    };
    await appendFile(this.deps.filePath, JSON.stringify(record) + "\n", "utf8");
  }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      /token|password|secret|apiKey|apikey|authorization/i.test(key) ? "[redacted]" : value,
    ])
  );
}
```

- [ ] **Step 4: Wire audit log into context**

Modify `packages/server/src/ws/dispatch.ts`:

```ts
import type { AutomationAuditLog } from "../automation/audit-log.js";
```

Add to `CommandContext`:

```ts
automationAuditLog?: AutomationAuditLog;
```

Modify `packages/server/src/server.ts`:

```ts
import { AutomationAuditLog } from "./automation/audit-log.js";
```

Instantiate:

```ts
const automationAuditLog = new AutomationAuditLog({
  filePath: join(stateRoot, "state", "automation-audit.jsonl"),
});
```

Add to `commandContext`.

MVP does not need to audit every command globally. Later tasks can call `automationAuditLog.append` from agent-triggered command routes once those command routes exist.

- [ ] **Step 5: Run test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/automation/audit-log.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/automation/audit-log.ts packages/server/src/__tests__/automation/audit-log.test.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts
git commit -m "feat: add automation audit log"
```

---

### Task 9: Surface Built-in Skills in Skills Panel

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-skills-panel.ts`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

- [ ] **Step 1: Write failing UI test**

In `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`, add translation fixture entries:

```ts
"workspace.skills.source.builtin": "Built-in",
"skills.builtin_title": "Built-in Skills",
```

Add test:

```tsx
it("shows built-in skills with a built-in source label", async () => {
  mockDispatch((op) => {
    if (op === "skills.library.list") {
      return Promise.resolve({
        ok: true,
        data: [
          {
            slug: "coder-studio-automation",
            displayName: "Coder Studio Automation",
            description: "Teach agents",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-automation",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: true },
          },
        ],
      });
    }
    if (op === "skills.health.scan") {
      return Promise.resolve({ ok: true, data: { targets: [], mounts: [] } });
    }
    if (op === "skills.targets.list") {
      return Promise.resolve({ ok: true, data: [] });
    }
    return Promise.resolve({ ok: true, data: [] });
  });

  renderPanel();

  expect(await screen.findByText("Coder Studio Automation")).toBeInTheDocument();
  expect(screen.getByText("Built-in")).toBeInTheDocument();
});
```

Use the file's existing mock helper names. If it uses a different dispatch mocking helper than `mockDispatch`, adapt the test to the local helper.

- [ ] **Step 2: Run UI test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/skills-panel.test.tsx
```

Expected: FAIL because source `builtin` has no label handling.

- [ ] **Step 3: Extend UI types**

Modify `packages/web/src/features/workspace/actions/use-skills-panel.ts` only if TypeScript complains. Since `SkillLibraryEntry.source` comes from core, the type should update after Task 1.

- [ ] **Step 4: Render built-in source label**

Modify source label mapping in `packages/web/src/features/workspace/views/shared/skills-panel.tsx` wherever existing `skillhub`/`local` labels are rendered:

```tsx
{item.source === "builtin"
  ? t("workspace.skills.source.builtin")
  : item.source === "local"
    ? t("workspace.skills.source.local")
    : t("workspace.skills.source.skillhub")}
```

If the component already has a helper function for source labels, update the helper instead of adding inline branching.

- [ ] **Step 5: Add i18n keys**

Find the locale files under `packages/web/src` with existing `workspace.skills.source.local` keys and add:

```json
"workspace.skills.source.builtin": "Built-in"
```

For Chinese locale:

```json
"workspace.skills.source.builtin": "内置"
```

If translations are in TypeScript records instead of JSON, update those records.

- [ ] **Step 6: Run UI test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/skills-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/workspace/actions/use-skills-panel.ts packages/web/src/features/workspace/views/shared/skills-panel.tsx packages/web/src/features/workspace/views/shared/skills-panel.test.tsx packages/web/src
git commit -m "feat: show built-in skills in skills panel"
```

---

### Task 10: Document MVP CLI and Skill Behavior

**Files:**
- Modify: `docs/help/cli.md`
- Modify: `docs/help/app-overview.md`
- Modify: `docs/PRD-agent-automation-skills.md` if implementation decisions changed during execution.

- [ ] **Step 1: Update CLI docs**

In `docs/help/cli.md`, add sections:

```md
### coder-studio identify

Prints machine-readable Coder Studio runtime context for an agent or local script.

```bash
coder-studio identify --json
```

When called inside a Coder Studio-managed agent session, the JSON includes workspace, session, provider, API URL, and permission context. Outside Coder Studio it returns `{"insideCoderStudio": false}`.

### coder-studio capabilities

Prints machine-readable automation capabilities available to the caller.

```bash
coder-studio capabilities --json
```

Agents should use this command instead of relying on a hardcoded command list.
```
```

- [ ] **Step 2: Update app overview**

In `docs/help/app-overview.md`, add a short section after Provider or Settings:

```md
### Built-in Skills

Coder Studio can distribute first-party skills to supported agent providers. These skills teach agents how to discover Coder Studio runtime context and automation capabilities through `coder-studio identify --json` and `coder-studio capabilities --json`.
```

- [ ] **Step 3: Review PRD alignment**

Open `docs/PRD-agent-automation-skills.md` and update any MVP details that changed during implementation. Do not mark Phase 2 browser automation or Phase 3 plugin/status as shipped.

- [ ] **Step 4: Commit**

```bash
git add docs/help/cli.md docs/help/app-overview.md docs/PRD-agent-automation-skills.md
git commit -m "docs: document agent automation skills mvp"
```

---

### Task 11: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm vitest run packages/core/src/domain/skill-management.test.ts
pnpm --filter @coder-studio/server test -- src/__tests__/skills/builtin-registry.test.ts src/__tests__/skills/builtin-sync-manager.test.ts src/__tests__/skills/commands.test.ts src/__tests__/automation/identify.test.ts src/__tests__/automation/capabilities.test.ts src/__tests__/automation/audit-log.test.ts src/__tests__/session-commands.test.ts
pnpm --filter @spencer-kit/coder-studio test -- src/bin.test.ts
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/skills-panel.test.tsx
```

Expected: all commands exit 0.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm ci:typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run lint/check if typecheck passes**

Run:

```bash
pnpm exec biome check --diagnostic-level=error --max-diagnostics=none packages/core packages/server packages/cli packages/web docs/PRD-agent-automation-skills.md docs/help/cli.md docs/help/app-overview.md
```

Expected: exit 0.

- [ ] **Step 4: Manual smoke test**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec tsx src/bin.ts identify --json
pnpm --filter @spencer-kit/coder-studio exec tsx src/bin.ts capabilities --json
```

Expected:

- `identify --json` outside a managed agent session prints JSON with `"insideCoderStudio": false`.
- `capabilities --json` prints JSON with a `commands` array containing `git.status`.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only files related to this plan are modified, plus the existing PRD if it has not already been committed.

- [ ] **Step 6: Final commit**

If previous tasks were not committed individually, commit all MVP changes:

```bash
git add packages/core packages/server packages/cli packages/web docs
git commit -m "feat: add agent automation skills mvp"
```

Do not commit unrelated user changes.
