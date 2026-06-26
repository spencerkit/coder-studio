# Terminal Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build server-owned terminal profiles with a configurable default profile, explicit per-launch profile selection, WSL-aware Windows behavior, and VS Code-style terminal creation UI in both the toolbar and settings.

**Architecture:** Keep profile detection, default resolution, custom profile merging, and launch-spec construction on the server. Expose a host-level `terminal.profiles.list` command plus a host-level `terminal.create` wrapper that resolves `profileId` and delegates to a narrow runtime spawn command. On the web side, reuse that DTO in a desktop split button, a mobile chooser sheet, and settings controls for default/custom profiles.

**Tech Stack:** TypeScript, Zod, pnpm workspace, Vitest, React 19, Jotai, existing websocket host/runtime command registries.

---

## File Map

- Create: `packages/core/src/domain/terminal-profiles.ts` — shared terminal profile DTOs and persisted custom profile shape.
- Modify: `packages/core/src/index.ts` — export the new DTO module.
- Create: `packages/server/src/terminal-profiles/detect.ts` — detect built-in native shells and WSL distros.
- Create: `packages/server/src/terminal-profiles/registry.ts` — merge detected + custom profiles, resolve defaults, and build launch specs.
- Create: `packages/server/src/terminal-profiles/wsl.ts` — WSL distro parsing and Windows-path-to-WSL-path conversion.
- Create: `packages/server/src/terminal-profiles/__tests__/registry.test.ts` — unit coverage for detection-independent resolution logic.
- Modify: `packages/server/src/commands/terminal.ts` — add host `terminal.profiles.list`, move client-facing `terminal.create` to host orchestration, add runtime `terminal.spawn`.
- Modify: `packages/server/src/commands/settings.ts` — add `terminal.defaultProfileId` and `terminal.profiles` schema + validation.
- Modify: `packages/server/src/commands/settings.test.ts` — cover terminal settings persistence and validation.
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts` — cover profile listing, explicit-profile create, unavailable-profile failures, and default fallback behavior.
- Create: `packages/web/src/features/terminal-panel/actions/use-terminal-profiles.ts` — fetch/cache terminal profiles for terminal UI.
- Modify: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts` — accept optional `profileId`.
- Modify: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx` — assert `profileId` dispatch behavior.
- Modify: `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts` — expose profile data and create handlers to the panel.
- Create: `packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx` — desktop split button + mobile chooser.
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx` — replace the single create action with the profile-aware launcher.
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx` — cover desktop default launch and alternate-profile selection.
- Create: `packages/web/src/features/settings/components/terminal-profile-settings.tsx` — default-profile picker and custom-profile editor.
- Modify: `packages/web/src/features/settings/components/settings-page.tsx` — load terminal settings/profile list state and render the new terminal profile settings block inside `GeneralSettings`.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx` — cover settings hydration and saving for terminal profiles.
- Modify: `packages/web/src/locales/en.json` — add terminal profile labels and validation copy.
- Modify: `packages/web/src/locales/zh.json` — add matching Chinese strings.

## Task 1: Shared DTOs and Server Terminal Profile Registry

**Files:**
- Create: `packages/core/src/domain/terminal-profiles.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/server/src/terminal-profiles/detect.ts`
- Create: `packages/server/src/terminal-profiles/registry.ts`
- Create: `packages/server/src/terminal-profiles/wsl.ts`
- Create: `packages/server/src/terminal-profiles/__tests__/registry.test.ts`
- Test: `packages/server/src/terminal-profiles/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing registry tests first**

```ts
import { describe, expect, it } from "vitest";
import type { CustomTerminalProfile } from "@coder-studio/core";
import { listTerminalProfiles, resolveTerminalLaunch } from "../registry.js";

const customProfiles: CustomTerminalProfile[] = [
  {
    id: "custom:node-shell",
    label: "Node Shell",
    command: "node",
    args: ["--interactive"],
    icon: "terminal",
  },
];

describe("terminal profile registry", () => {
  it("keeps the configured default id while resolving a fallback available profile", async () => {
    const result = await listTerminalProfiles({
      platform: "linux",
      shellPath: "/bin/zsh",
      configuredDefaultProfileId: "detected:win:powershell",
      customProfiles,
      detectProfiles: async () => [
        {
          id: "detected:posix:zsh",
          label: "zsh",
          source: "detected",
          runtime: "native",
          icon: "terminal",
          argv: ["/bin/zsh", "-i"],
          cwdRuntime: "native",
        },
      ],
    });

    expect(result.configuredDefaultProfileId).toBe("detected:win:powershell");
    expect(result.resolvedDefaultProfileId).toBe("detected:posix:zsh");
    expect(result.profiles.map((profile) => profile.id)).toEqual([
      "detected:posix:zsh",
      "custom:node-shell",
    ]);
  });

  it("throws for an explicitly requested unavailable profile instead of silently falling back", async () => {
    await expect(
      resolveTerminalLaunch({
        platform: "linux",
        shellPath: "/bin/zsh",
        configuredDefaultProfileId: "detected:posix:zsh",
        requestedProfileId: "detected:win:pwsh",
        customProfiles: [],
        workspacePath: "/repo/app",
        detectProfiles: async () => [
          {
            id: "detected:posix:zsh",
            label: "zsh",
            source: "detected",
            runtime: "native",
            icon: "terminal",
            argv: ["/bin/zsh", "-i"],
            cwdRuntime: "native",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "terminal_profile_unavailable",
      message: "Terminal profile unavailable: detected:win:pwsh",
    });
  });

  it("builds a WSL launch spec with mapped cwd when the workspace is on a Windows drive", async () => {
    const launch = await resolveTerminalLaunch({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      workspacePath: "C:\\repo\\app",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(launch.argv).toEqual([
      "wsl.exe",
      "-d",
      "Ubuntu-24.04",
      "--cd",
      "/mnt/c/repo/app",
    ]);
    expect(launch.cwd).toBe("C:\\repo\\app");
    expect(launch.profileId).toBe("detected:win:wsl:Ubuntu-24.04");
  });

  it("falls back to the distro home when a WSL cwd cannot be mapped", async () => {
    const launch = await resolveTerminalLaunch({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      workspacePath: "\\\\wsl$\\Ubuntu-24.04\\repo\\app",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(launch.argv).toEqual(["wsl.exe", "-d", "Ubuntu-24.04"]);
    expect(launch.cwd).toBe("\\\\wsl$\\Ubuntu-24.04\\repo\\app");
  });
});
```

- [ ] **Step 2: Run the new registry test and verify it fails for the missing module/functionality**

Run: `pnpm --filter @coder-studio/server exec vitest run src/terminal-profiles/__tests__/registry.test.ts`

Expected: FAIL with a module-resolution or missing-export error for `../registry.js`, plus `0 passed`.

- [ ] **Step 3: Add the shared DTOs and registry implementation**

```ts
// packages/core/src/domain/terminal-profiles.ts
export type TerminalProfileSource = "detected" | "custom";
export type TerminalProfileRuntime = "native" | "wsl";

export interface TerminalProfile {
  id: string;
  label: string;
  source: TerminalProfileSource;
  runtime: TerminalProfileRuntime;
  icon: string;
}

export interface CustomTerminalProfile {
  id: `custom:${string}`;
  label: string;
  command: string;
  args?: string[];
  icon?: string;
}

export interface TerminalProfilesListResult {
  profiles: TerminalProfile[];
  configuredDefaultProfileId?: string;
  resolvedDefaultProfileId: string | null;
}
```

```ts
// packages/server/src/terminal-profiles/wsl.ts
import path from "node:path";

export function toWslPath(windowsPath: string): string | null {
  const parsed = path.win32.parse(windowsPath);
  if (!parsed.root || !/^[A-Za-z]:\\$/.test(parsed.root)) {
    return null;
  }

  const drive = parsed.root[0]!.toLowerCase();
  const relative = windowsPath.slice(parsed.root.length).replace(/\\/g, "/");
  return `/mnt/${drive}${relative ? `/${relative}` : ""}`;
}

export function appendWslCwd(argv: string[], mappedCwd: string | null): string[] {
  if (!mappedCwd) {
    return argv;
  }
  return [...argv, "--cd", mappedCwd];
}
```

```ts
// packages/server/src/terminal-profiles/registry.ts
import type {
  CustomTerminalProfile,
  TerminalProfile,
  TerminalProfilesListResult,
} from "@coder-studio/core";
import { detectTerminalProfiles, type DetectedTerminalProfile } from "./detect.js";
import { appendWslCwd, toWslPath } from "./wsl.js";

export interface ResolvedTerminalLaunch {
  profileId: string;
  title: string;
  argv: string[];
  cwd: string;
}

interface RegistryInput {
  platform?: NodeJS.Platform;
  shellPath?: string;
  configuredDefaultProfileId?: string;
  customProfiles: CustomTerminalProfile[];
  workspacePath?: string;
  detectProfiles?: () => Promise<DetectedTerminalProfile[]>;
}

export async function listTerminalProfiles(
  input: RegistryInput
): Promise<TerminalProfilesListResult> {
  const detected = await (input.detectProfiles
    ? input.detectProfiles()
    : detectTerminalProfiles({
        platform: input.platform,
        shellPath: input.shellPath,
      }));

  const profiles: TerminalProfile[] = [
    ...detected.map(toDto),
    ...input.customProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      source: "custom",
      runtime: "native",
      icon: profile.icon ?? "terminal",
    })),
  ];

  const configuredDefaultProfileId = input.configuredDefaultProfileId;
  const resolvedDefaultProfileId =
    profiles.find((profile) => profile.id === configuredDefaultProfileId)?.id ??
    profiles[0]?.id ??
    null;

  return {
    profiles,
    configuredDefaultProfileId,
    resolvedDefaultProfileId,
  };
}

export async function resolveTerminalLaunch(input: RegistryInput & { requestedProfileId?: string }) {
  if (!input.workspacePath) {
    throw new Error("workspacePath is required for resolveTerminalLaunch");
  }

  const detected = await (input.detectProfiles
    ? input.detectProfiles()
    : detectTerminalProfiles({
        platform: input.platform,
        shellPath: input.shellPath,
      }));

  const definitions = new Map<string, DetectedTerminalProfile | CustomTerminalProfile>(
    detected.map((profile) => [profile.id, profile]).concat(input.customProfiles.map((profile) => [profile.id, profile]))
  );

  const summary = await listTerminalProfiles(input);
  const targetId = input.requestedProfileId ?? summary.resolvedDefaultProfileId;

  if (!targetId) {
    throw {
      code: "terminal_profile_unavailable",
      message: "No terminal profiles are available on this machine",
    };
  }

  const profile = definitions.get(targetId);
  if (!profile) {
    throw {
      code: "terminal_profile_unavailable",
      message: `Terminal profile unavailable: ${targetId}`,
    };
  }

  if ("command" in profile) {
    return {
      profileId: profile.id,
      title: profile.label,
      argv: [profile.command, ...(profile.args ?? [])],
      cwd: input.workspacePath,
    } satisfies ResolvedTerminalLaunch;
  }

  if (profile.cwdRuntime === "wsl") {
    return {
      profileId: profile.id,
      title: profile.label,
      argv: appendWslCwd(profile.argv, toWslPath(input.workspacePath)),
      cwd: input.workspacePath,
    } satisfies ResolvedTerminalLaunch;
  }

  return {
    profileId: profile.id,
    title: profile.label,
    argv: profile.argv,
    cwd: input.workspacePath,
  } satisfies ResolvedTerminalLaunch;
}

function toDto(profile: DetectedTerminalProfile): TerminalProfile {
  return {
    id: profile.id,
    label: profile.label,
    source: profile.source,
    runtime: profile.runtime,
    icon: profile.icon,
  };
}
```

- [ ] **Step 4: Run the registry test again and verify it passes**

Run: `pnpm --filter @coder-studio/server exec vitest run src/terminal-profiles/__tests__/registry.test.ts`

Expected: PASS with `4 passed` and exit code `0`.

- [ ] **Step 5: Commit only the Task 1 files**

```bash
git add packages/core/src/domain/terminal-profiles.ts packages/core/src/index.ts packages/server/src/terminal-profiles/detect.ts packages/server/src/terminal-profiles/registry.ts packages/server/src/terminal-profiles/wsl.ts packages/server/src/terminal-profiles/__tests__/registry.test.ts
git commit -m "feat: add terminal profile registry"
```

## Task 2: Host Commands, Runtime Spawn Command, and Terminal Settings Schema

**Files:**
- Modify: `packages/server/src/commands/terminal.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/server/src/__tests__/terminal-commands.test.ts`

- [ ] **Step 1: Write the failing command/settings tests**

```ts
it("returns terminal profiles with configured and resolved default ids", async () => {
  const settingsRepo = new SettingsRepo({ filePath: join(tempDir, "settings.json") });
  settingsRepo.set("terminal.defaultProfileId", "detected:win:powershell");
  settingsRepo.set("terminal.profiles", [
    {
      id: "custom:node-shell",
      label: "Node Shell",
      command: "node",
      args: ["--interactive"],
      icon: "terminal",
    },
  ]);

  const result = await dispatch(
    {
      kind: "command",
      id: "terminal-profiles-list-1",
      op: "terminal.profiles.list",
      args: {},
    },
    createContext({ settingsRepo })
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    configuredDefaultProfileId: "detected:win:powershell",
    resolvedDefaultProfileId: expect.any(String),
  });
});

it("passes the requested profileId through terminal.create and errors when that profile is missing", async () => {
  const settingsRepo = {
    get: vi.fn((key: string) => {
      if (key === "terminal.defaultProfileId") return "detected:posix:zsh";
      if (key === "terminal.profiles") return [];
      return undefined;
    }),
  } as never;

  const missingResult = await dispatch(
    {
      kind: "command",
      id: "terminal-create-missing-profile",
      op: "terminal.create",
      args: {
        workspaceId: "ws-1",
        profileId: "detected:win:pwsh",
      },
    },
    createContext({ settingsRepo })
  );

  expect(missingResult.ok).toBe(false);
  expect(missingResult.error).toMatchObject({
    code: "terminal_profile_unavailable",
  });
});

it("settings.update persists terminal.defaultProfileId and terminal.profiles", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "settings-update-terminal-profiles",
      op: "settings.update",
      args: {
        settings: {
          terminal: {
            defaultProfileId: "custom:node-shell",
            profiles: [
              {
                id: "custom:node-shell",
                label: "Node Shell",
                command: "node",
                args: ["--interactive"],
                icon: "terminal",
              },
            ],
          },
        },
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(settingsRepo.get("terminal.defaultProfileId")).toBe("custom:node-shell");
  expect(settingsRepo.get("terminal.profiles")).toEqual([
    {
      id: "custom:node-shell",
      label: "Node Shell",
      command: "node",
      args: ["--interactive"],
      icon: "terminal",
    },
  ]);
});
```

- [ ] **Step 2: Run the command/settings tests and verify they fail for the new behavior**

Run: `pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts src/__tests__/terminal-commands.test.ts`

Expected: FAIL with `unknown_op` for `terminal.profiles.list`, schema validation failures for `terminal.profiles`, and at least one assertion mismatch around `profileId`.

- [ ] **Step 3: Implement the host commands and settings schema**

```ts
// packages/server/src/commands/settings.ts
import type { CustomTerminalProfile } from "@coder-studio/core";

const CustomTerminalProfileSchema = z.object({
  id: z.string().regex(/^custom:/),
  label: z.string().trim().min(1),
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  icon: z.string().trim().min(1).optional(),
});

const TerminalSettingsSchema = z
  .object({
    defaultProfileId: z.string().optional(),
    profiles: z.array(CustomTerminalProfileSchema).optional(),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const profile of value.profiles ?? []) {
      if (ids.has(profile.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate terminal profile id: ${profile.id}`,
          path: ["profiles"],
        });
      }
      ids.add(profile.id);
    }
  });

```diff
 const SettingsSchema = z.object({
+  terminal: TerminalSettingsSchema.optional(),
 });
```

```ts
// packages/server/src/commands/terminal.ts
registerCommand("terminal.profiles.list", z.object({}).default({}), async (_args, ctx) => {
  return await listTerminalProfiles({
    platform: process.platform,
    shellPath: process.env.SHELL,
    configuredDefaultProfileId: ctx.settingsRepo.get("terminal.defaultProfileId"),
    customProfiles: (ctx.settingsRepo.get("terminal.profiles") as CustomTerminalProfile[]) ?? [],
  });
});

registerRuntimeCommand(
  "terminal.spawn",
  z.object({
    workspaceId: z.string(),
    argv: z.array(z.string()).min(1),
    title: z.string().min(1),
    cwd: z.string().min(1),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    themeBackground: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      return ctx.terminalMgr.create({
        workspaceId: args.workspaceId,
        kind: "shell",
        argv: args.argv,
        title: args.title,
        cwd: args.cwd,
        cols: args.cols ?? 120,
        rows: args.rows ?? 30,
        themeBackground: args.themeBackground,
      });
    },
  }
);

registerHostCommand(
  "terminal.create",
  z.object({
    workspaceId: z.string(),
    profileId: z.string().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    cwdPath: z.string().optional(),
    themeBackground: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  }),
  async (args, ctx, meta) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const cwd = await resolveWorkspaceCwd(workspace.path, args.cwdPath);
    const launch = await resolveTerminalLaunch({
      platform: process.platform,
      shellPath: process.env.SHELL,
      configuredDefaultProfileId: ctx.settingsRepo.get("terminal.defaultProfileId"),
      requestedProfileId: args.profileId,
      customProfiles: (ctx.settingsRepo.get("terminal.profiles") as CustomTerminalProfile[]) ?? [],
      workspacePath: cwd,
    });

    return await executeRuntimeCommandOnTarget(
      "terminal.spawn",
      {
        workspaceId: args.workspaceId,
        argv: launch.argv,
        title: launch.title,
        cwd: launch.cwd,
        cols: args.cols,
        rows: args.rows,
        themeBackground: args.themeBackground,
      },
      ctx,
      meta,
      { kind: "workspace", workspaceId: args.workspaceId }
    );
  }
);
```

- [ ] **Step 4: Run the server terminal/settings tests again and verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts src/__tests__/terminal-commands.test.ts`

Expected: PASS with all assertions green and exit code `0`.

- [ ] **Step 5: Commit only the Task 2 files**

```bash
git add packages/server/src/commands/terminal.ts packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts packages/server/src/__tests__/terminal-commands.test.ts
git commit -m "feat: wire terminal profile commands"
```

## Task 3: Terminal Toolbar Profiles UX

**Files:**
- Create: `packages/web/src/features/terminal-panel/actions/use-terminal-profiles.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- Create: `packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Test: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx`
- Test: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`

- [ ] **Step 1: Write the failing web tests first**

```ts
it("passes profileId to terminal.create when a non-default terminal profile is selected", async () => {
  const sendCommand = vi.fn().mockResolvedValue({
    id: "term_2",
    workspaceId: "ws-test",
    kind: "shell",
    title: "Git Bash",
    cwd: "/tmp/ws-test",
    argv: ["bash"],
    cols: 120,
    rows: 30,
    alive: true,
    createdAt: 1,
  });

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  const { result } = renderHook(() => useCreateShellTerminal("ws-test"), {
    wrapper: wrapperFor(store),
  });

  await act(async () => {
    await result.current.createShellTerminal({ profileId: "detected:win:git-bash" });
  });

  expect(sendCommand).toHaveBeenCalledWith(
    "terminal.create",
    expect.objectContaining({
      workspaceId: "ws-test",
      profileId: "detected:win:git-bash",
    }),
    undefined
  );
});

it("uses the resolved default profile from the primary toolbar button and opens the profile picker from the chevron", async () => {
  const sendCommand = vi.fn().mockImplementation((op: string) => {
    if (op === "terminal.list") return Promise.resolve([]);
    if (op === "terminal.profiles.list") {
      return Promise.resolve({
        configuredDefaultProfileId: "detected:win:pwsh",
        resolvedDefaultProfileId: "detected:win:pwsh",
        profiles: [
          { id: "detected:win:pwsh", label: "PowerShell", source: "detected", runtime: "native", icon: "terminal" },
          { id: "detected:win:git-bash", label: "Git Bash", source: "detected", runtime: "native", icon: "terminal" },
        ],
      });
    }
    if (op === "terminal.create") {
      return Promise.resolve({
        id: "term_2",
        workspaceId: "ws-test",
        kind: "shell",
        title: "PowerShell",
        cwd: "/tmp/ws-test",
        argv: ["pwsh"],
        cols: 120,
        rows: 30,
        alive: true,
        createdAt: 1,
      });
    }
    return Promise.resolve(undefined);
  });

  render(
    <Provider store={store}>
      <TerminalPanel />
    </Provider>
  );

  await user.click(screen.getByRole("button", { name: "New Terminal" }));
  expect(sendCommand).toHaveBeenCalledWith(
    "terminal.create",
    expect.objectContaining({ profileId: "detected:win:pwsh" }),
    undefined
  );

  await user.click(screen.getByRole("button", { name: "Choose Terminal Profile" }));
  expect(await screen.findByText("Git Bash")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the web terminal tests and verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx`

Expected: FAIL because `profileId` is absent from the create hook dispatch, `terminal.profiles.list` is never requested, and the chooser button does not exist yet.

- [ ] **Step 3: Implement the terminal profile hook and split-button UI**

```ts
// packages/web/src/features/terminal-panel/actions/use-terminal-profiles.ts
import type { TerminalProfile, TerminalProfilesListResult } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";

export function useTerminalProfiles() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [data, setData] = useState<TerminalProfilesListResult>({
    profiles: [],
    resolvedDefaultProfileId: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void dispatch<TerminalProfilesListResult>("terminal.profiles.list", {})
      .then((result) => {
        if (!cancelled && result.ok && result.data) {
          setData(result.data);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const defaultProfile =
    data.profiles.find((profile) => profile.id === data.resolvedDefaultProfileId) ?? null;

  return {
    profiles: data.profiles,
    configuredDefaultProfileId: data.configuredDefaultProfileId,
    resolvedDefaultProfileId: data.resolvedDefaultProfileId,
    defaultProfile,
    loading,
  };
}
```

```ts
// packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts
async createShellTerminal(args: { cwdPath?: string; profileId?: string } = {}) {
  if (!workspaceId) {
    pushToast({
      kind: "warning",
      title: t("terminal.create_unavailable_title"),
      body: t("terminal.create_unavailable_body"),
    });
    return null;
  }

  try {
    const result = await dispatch<TerminalDto>("terminal.create", {
      workspaceId,
      cwdPath: args.cwdPath,
      profileId: args.profileId,
      themeBackground,
    });

    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("terminal.create_failed_title"),
        body: result.error?.message ?? t("terminal.create_failed_body"),
      });
      return null;
    }

    const terminal = result.data;
    store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
    store.set(terminalIdsAtomFamily(workspaceId), (current) =>
      current.includes(terminal.id) ? current : [...current, terminal.id]
    );
    store.set(terminalActiveIdAtomFamily(workspaceId), terminal.id);
    return terminal;
  } catch (error) {
    pushToast({
      kind: "error",
      title: t("terminal.create_failed_title"),
      body: error instanceof Error ? error.message : t("terminal.create_failed_body"),
    });
    return null;
  }
}
```

```tsx
// packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx
import type { TerminalProfile } from "@coder-studio/core";
import { ChevronDown } from "lucide-react";
import { Button, IconButton, Popover, ThemedIcon, Tooltip } from "../../../../components/ui";
import { MobileSelectSheet } from "../../../mobile-select";

export function TerminalProfileCreateButton(props: {
  mobile: boolean;
  loading: boolean;
  profiles: TerminalProfile[];
  defaultProfile: TerminalProfile | null;
  onCreate: (profileId?: string) => Promise<void>;
}) {
  if (props.mobile) {
    return (
      <>
        <IconButton
          aria-label="New Terminal"
          icon={<ThemedIcon semantic="terminal.action.new" size={14} />}
          onClick={() => void props.onCreate(props.defaultProfile?.id)}
          size="sm"
        />
        <MobileSelectSheet
          title="Terminal Profiles"
          sections={[
            {
              kind: "actions",
              id: "default-profile",
              items: props.defaultProfile
                ? [
                    {
                      id: "open-default-profile",
                      label: `Open Default: ${props.defaultProfile.label}`,
                      onAction: () => props.onCreate(props.defaultProfile?.id),
                    },
                  ]
                : [],
            },
            {
              kind: "options",
              id: "other-profiles",
              title: "Other Profiles",
              items: props.profiles.map((profile) => ({
                id: profile.id,
                label: profile.label,
                meta: profile.id === props.defaultProfile?.id ? "Default" : undefined,
              })),
            },
          ]}
          onSelect={(profileId) => props.onCreate(profileId)}
          onClose={() => {}}
        />
      </>
    );
  }

  return (
    <div className="terminal-create-split">
      <Tooltip content={props.defaultProfile ? `Open ${props.defaultProfile.label}` : "New Terminal"}>
        <Button onClick={() => void props.onCreate(props.defaultProfile?.id)}>
          <ThemedIcon semantic="terminal.action.new" size={14} />
          <span>New Terminal</span>
        </Button>
      </Tooltip>
      <Popover
        title="Terminal Profiles"
        content={
          <>
            {props.profiles.map((profile) => (
              <button key={profile.id} type="button" onClick={() => void props.onCreate(profile.id)}>
                {profile.label}
              </button>
            ))}
          </>
        }
      >
        <IconButton aria-label="Choose Terminal Profile" icon={<ChevronDown size={14} />} size="sm" />
      </Popover>
    </div>
  );
}
```

- [ ] **Step 4: Run the web terminal tests again and verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx`

Expected: PASS with the hook and terminal panel assertions green.

- [ ] **Step 5: Commit only the Task 3 files**

```bash
git add packages/web/src/features/terminal-panel/actions/use-terminal-profiles.ts packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx
git commit -m "feat: add terminal profile launcher ui"
```

## Task 4: Settings UI for Default and Custom Terminal Profiles

**Files:**
- Create: `packages/web/src/features/settings/components/terminal-profile-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Write the failing settings-page tests**

```ts
it("hydrates the terminal profile settings from settings.get and terminal.profiles.list", async () => {
  const sendCommand = createDefaultCommandHandler({
    settings: {
      "terminal.defaultProfileId": "custom:node-shell",
      "terminal.profiles": [
        {
          id: "custom:node-shell",
          label: "Node Shell",
          command: "node",
          args: ["--interactive"],
          icon: "terminal",
        },
      ],
    },
  }).mockImplementation(async (op: string) => {
    if (op === "settings.get") {
      return {
        "terminal.defaultProfileId": "custom:node-shell",
        "terminal.profiles": [
          {
            id: "custom:node-shell",
            label: "Node Shell",
            command: "node",
            args: ["--interactive"],
            icon: "terminal",
          },
        ],
      };
    }
    if (op === "terminal.profiles.list") {
      return {
        configuredDefaultProfileId: "custom:node-shell",
        resolvedDefaultProfileId: "custom:node-shell",
        profiles: [
          { id: "detected:posix:zsh", label: "zsh", source: "detected", runtime: "native", icon: "terminal" },
          { id: "custom:node-shell", label: "Node Shell", source: "custom", runtime: "native", icon: "terminal" },
        ],
      };
    }
    return {};
  });

  renderSettingsPage(sendCommand);

  expect(await screen.findByLabelText("Default Terminal Profile")).toHaveValue("custom:node-shell");
  expect(screen.getByDisplayValue("Node Shell")).toBeInTheDocument();
  expect(screen.getByDisplayValue("node")).toBeInTheDocument();
});

it("saves a new custom profile and updates terminal.defaultProfileId", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "settings.get") return {};
    if (op === "provider.list") return DEFAULT_PROVIDER_LIST;
    if (op === "terminal.profiles.list") {
      return {
        configuredDefaultProfileId: undefined,
        resolvedDefaultProfileId: "detected:posix:zsh",
        profiles: [
          { id: "detected:posix:zsh", label: "zsh", source: "detected", runtime: "native", icon: "terminal" },
        ],
      };
    }
    return { updated: ["terminal.defaultProfileId", "terminal.profiles"] };
  });

  renderSettingsPage(sendCommand);

  await user.click(await screen.findByRole("button", { name: "Add Terminal Profile" }));
  await user.type(screen.getByLabelText("Profile Label"), "Node Shell");
  await user.type(screen.getByLabelText("Command"), "node");
  await user.type(screen.getByLabelText("Arguments"), "--interactive");
  await user.selectOptions(screen.getByLabelText("Default Terminal Profile"), "custom:node-shell");

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "settings.update",
      {
        settings: {
          terminal: {
            defaultProfileId: "custom:node-shell",
            profiles: [
              {
                id: "custom:node-shell",
                label: "Node Shell",
                command: "node",
                args: ["--interactive"],
                icon: "terminal",
              },
            ],
          },
        },
      },
      undefined
    );
  });
});

it("edits and deletes an existing custom profile without changing other settings", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "settings.get") {
      return {
        "terminal.defaultProfileId": "custom:node-shell",
        "terminal.profiles": [
          {
            id: "custom:node-shell",
            label: "Node Shell",
            command: "node",
            args: ["--interactive"],
            icon: "terminal",
          },
        ],
      };
    }
    if (op === "provider.list") return DEFAULT_PROVIDER_LIST;
    if (op === "terminal.profiles.list") {
      return {
        configuredDefaultProfileId: "custom:node-shell",
        resolvedDefaultProfileId: "custom:node-shell",
        profiles: [
          { id: "detected:posix:zsh", label: "zsh", source: "detected", runtime: "native", icon: "terminal" },
          { id: "custom:node-shell", label: "Node Shell", source: "custom", runtime: "native", icon: "terminal" },
        ],
      };
    }
    return { updated: ["terminal.defaultProfileId", "terminal.profiles"] };
  });

  renderSettingsPage(sendCommand);

  const labelInput = await screen.findByDisplayValue("Node Shell");
  await user.clear(labelInput);
  await user.type(labelInput, "Node REPL");

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "settings.update",
      {
        settings: {
          terminal: {
            defaultProfileId: "custom:node-shell",
            profiles: [
              {
                id: "custom:node-shell",
                label: "Node REPL",
                command: "node",
                args: ["--interactive"],
                icon: "terminal",
              },
            ],
          },
        },
      },
      undefined
    );
  });

  await user.click(screen.getByRole("button", { name: "Remove Profile" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "settings.update",
      {
        settings: {
          terminal: {
            defaultProfileId: undefined,
            profiles: [],
          },
        },
      },
      undefined
    );
  });
});
```

- [ ] **Step 2: Run the settings-page test and verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`

Expected: FAIL because the settings page never requests `terminal.profiles.list`, has no terminal profile controls, and never posts `terminal.defaultProfileId` or `terminal.profiles`.

- [ ] **Step 3: Implement the settings component and localization**

```tsx
// packages/web/src/features/settings/components/terminal-profile-settings.tsx
import type { CustomTerminalProfile, TerminalProfile } from "@coder-studio/core";
import { Button, Input, Select } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

function nextCustomProfileId(label: string): `custom:${string}` {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `custom:${normalized || crypto.randomUUID()}`;
}

function newDraftProfileId(): `custom:${string}` {
  return `custom:draft-${crypto.randomUUID()}`;
}

function resolvePersistedProfileId(profile: CustomTerminalProfile): `custom:${string}` {
  if (!profile.id.startsWith("custom:draft-") || !profile.label.trim()) {
    return profile.id;
  }
  return nextCustomProfileId(profile.label);
}

export function TerminalProfileSettings(props: {
  profiles: TerminalProfile[];
  defaultProfileId?: string;
  customProfiles: CustomTerminalProfile[];
  onSave: (settings: { defaultProfileId?: string; profiles: CustomTerminalProfile[] }) => Promise<void>;
}) {
  const t = useTranslation();

  const persist = async (
    nextProfiles: CustomTerminalProfile[],
    nextDefaultProfileId = props.defaultProfileId
  ) => {
    const safeDefaultProfileId =
      nextDefaultProfileId && nextProfiles.some((profile) => profile.id === nextDefaultProfileId)
        ? nextDefaultProfileId
        : props.profiles.some((profile) => profile.id === nextDefaultProfileId)
          ? nextDefaultProfileId
          : undefined;

    await props.onSave({
      defaultProfileId: safeDefaultProfileId,
      profiles: nextProfiles,
    });
  };

  const updateProfile = (
    profileId: string,
    patch: Partial<Pick<CustomTerminalProfile, "label" | "command" | "args" | "icon">>
  ) => {
    const nextProfiles = props.customProfiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const merged = { ...profile, ...patch };
      return {
        ...merged,
        id: resolvePersistedProfileId(merged),
      };
    });
    void persist(nextProfiles);
  };

  const removeProfile = (profileId: string) => {
    const nextProfiles = props.customProfiles.filter((profile) => profile.id !== profileId);
    const nextDefaultProfileId =
      props.defaultProfileId === profileId ? undefined : props.defaultProfileId;
    void persist(nextProfiles, nextDefaultProfileId);
  };

  const addProfile = () => {
    const profileId = newDraftProfileId();
    const nextProfiles = [
      ...props.customProfiles,
      {
        id: profileId,
        label: "Custom Profile",
        command: "",
        args: [],
        icon: "terminal",
      },
    ];
    void persist(nextProfiles);
  };

  return (
    <div className="settings-group">
      <h3 className="settings-group-title">{t("settings.terminal_profiles.title")}</h3>
      <p className="settings-group-desc">{t("settings.terminal_profiles.hint")}</p>

      <label className="settings-config-label" htmlFor="terminal-default-profile">
        {t("settings.terminal_profiles.default_label")}
      </label>
      <Select
        aria-label={t("settings.terminal_profiles.default_label")}
        id="terminal-default-profile"
        options={props.profiles.map((profile) => ({
          value: profile.id,
          label: profile.label,
        }))}
        value={props.defaultProfileId ?? ""}
        onChange={(event) => {
          void persist(props.customProfiles, event.target.value || undefined);
        }}
      />

      {props.customProfiles.map((profile) => (
        <div key={profile.id} className="settings-profile-card">
          <Input
            aria-label={t("settings.terminal_profiles.profile_label")}
            value={profile.label}
            onChange={(event) => {
              updateProfile(profile.id, { label: event.target.value });
            }}
          />
          <Input
            aria-label={t("settings.terminal_profiles.command")}
            value={profile.command}
            onChange={(event) => {
              updateProfile(profile.id, { command: event.target.value });
            }}
          />
          <Input
            aria-label={t("settings.terminal_profiles.arguments")}
            value={(profile.args ?? []).join(" ")}
            onChange={(event) => {
              updateProfile(profile.id, {
                args: event.target.value
                  .split(/\s+/)
                  .map((token) => token.trim())
                  .filter(Boolean),
              });
            }}
          />
          <Button tone="danger" onClick={() => removeProfile(profile.id)}>
            {t("settings.terminal_profiles.remove")}
          </Button>
        </div>
      ))}

      <Button onClick={addProfile}>{t("settings.terminal_profiles.add")}</Button>
    </div>
  );
}
```

```json
// packages/web/src/locales/en.json
{
  "settings": {
    "terminal_profiles": {
      "title": "Terminal Profiles",
      "hint": "Choose the default profile and manage custom launch commands.",
      "default_label": "Default Terminal Profile",
      "profile_label": "Profile Label",
      "command": "Command",
      "arguments": "Arguments",
      "arguments_hint": "Separate arguments with spaces. Use one field for the full command token.",
      "add": "Add Terminal Profile",
      "remove": "Remove Profile"
    }
  }
}
```

- [ ] **Step 4: Run the settings-page test again and verify it passes**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`

Expected: PASS with the new terminal profile settings assertions green.

- [ ] **Step 5: Commit only the Task 4 files**

```bash
git add packages/web/src/features/settings/components/terminal-profile-settings.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: add terminal profile settings"
```

## Task 5: Full Verification, Review, and Final Cleanup

**Files:**
- Modify: `packages/core/src/domain/terminal-profiles.ts`
- Modify: `packages/server/src/terminal-profiles/detect.ts`
- Modify: `packages/server/src/terminal-profiles/registry.ts`
- Modify: `packages/server/src/terminal-profiles/wsl.ts`
- Modify: `packages/server/src/commands/terminal.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-terminal-profiles.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Modify: `packages/web/src/features/settings/components/terminal-profile-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/server/src/terminal-profiles/__tests__/registry.test.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/server/src/__tests__/terminal-commands.test.ts`
- Test: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx`
- Test: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Run the focused feature test suite**

Run: `pnpm --filter @coder-studio/server exec vitest run src/terminal-profiles/__tests__/registry.test.ts src/commands/settings.test.ts src/__tests__/terminal-commands.test.ts && pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx src/features/settings/components/settings-page.test.tsx`

Expected: PASS for all targeted terminal profile tests, exit code `0`.

- [ ] **Step 2: Run package builds/type checks that prove the touched packages still compile**

Run: `pnpm --filter @coder-studio/core build && pnpm --filter @coder-studio/server build && pnpm --filter @coder-studio/web build`

Expected: PASS for all three packages, exit code `0`.

- [ ] **Step 3: Run repository-level verification before claiming completion**

Run: `pnpm ci:verify`

Expected: PASS with lint, tests, and builds green across the repository.

- [ ] **Step 4: Review the diff against the spec and fix anything missing before the final handoff**

```bash
git status --short
git diff --stat 58c39d4d..HEAD
```

Expected: only the planned terminal profile files are included in the feature commits, plus any deliberate follow-up fixes from verification.

- [ ] **Step 5: Commit any verification/review fixes if needed**

```bash
git add packages/core/src/domain/terminal-profiles.ts packages/server/src/terminal-profiles packages/server/src/commands/terminal.ts packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts packages/server/src/__tests__/terminal-commands.test.ts packages/web/src/features/terminal-panel packages/web/src/features/settings/components/terminal-profile-settings.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "fix: address terminal profile verification feedback"
```

## Self-Review

### Spec Coverage Check

- Unified cross-platform terminal profile DTOs: Task 1.
- Server-owned detection, merge, default resolution, and WSL handling: Tasks 1-2.
- `terminal.create(profileId?)` plus `terminal.profiles.list`: Task 2.
- No silent fallback for an explicitly selected unavailable profile: Tasks 1-2 tests.
- Preserve `configuredDefaultProfileId` while computing `resolvedDefaultProfileId`: Tasks 1-2 tests.
- Desktop split button and mobile chooser: Task 3.
- Settings support for default profile and custom profile CRUD: Task 4.
- Locales and user-facing copy for the new settings/UI flows: Task 4.
- Full verification before handoff: Task 5.

### Placeholder Scan

- No `TODO`, `TBD`, or “similar to Task N” placeholders remain.
- Every task includes concrete files, commands, commit messages, and code snippets.

### Type Consistency Check

- Shared persisted custom profile type is `CustomTerminalProfile`.
- Server list command returns `TerminalProfilesListResult`.
- Client create flow sends `profileId?: string` to `terminal.create`.
- Unavailable explicit selection always throws `terminal_profile_unavailable`.
