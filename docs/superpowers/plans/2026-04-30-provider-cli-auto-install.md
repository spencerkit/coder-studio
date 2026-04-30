# Provider CLI Auto-Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `Claude` / `Codex` 会话入口实现启动前 CLI 检查、自动安装、失败原因回传和手动安装引导，并在安装成功后自动继续创建会话。

**Architecture:** 后端新增一层 provider runtime/install 服务：统一做 `where` / `which` 命令探测、按 provider 元数据生成安装计划、维护内存中的安装 job，并在 `session.create` 前做最终兜底校验。前端在 `DraftLauncher` 上挂一个独立 hook，先拉 `provider.runtimeStatus`，再根据状态决定“启动会话 / 安装并启动 / 查看手动安装步骤”，安装进度通过 `provider.install.get` 轮询，不新增新的 WS topic。

**Tech Stack:** TypeScript 6 · Node.js child_process (`execFile`) · React 19 · Jotai · React Router · Vitest · pnpm workspaces

---

## File Structure

- Modify: `packages/core/src/provider/definition.ts` — 为 provider 定义增加安装元数据类型。
- Modify: `packages/core/src/domain/types.ts` — 增加 runtime status、install job、install failure 等跨端共享类型。
- Modify: `packages/core/src/index.ts` — 导出新增类型。
- Modify: `packages/providers/src/claude/definition.ts` — 为 Claude 填充安装包名、文档地址、平台策略。
- Modify: `packages/providers/src/codex/definition.ts` — 为 Codex 填充安装包名、文档地址、平台策略。
- Modify: `packages/providers/src/claude/definition.test.ts` — 覆盖 Claude 安装元数据。
- Modify: `packages/providers/src/codex/definition.test.ts` — 覆盖 Codex 安装元数据。
- Create: `packages/server/src/provider-runtime/command-check.ts` — 统一封装 `where` / `which` 探测和 `execFile` 注入。
- Create: `packages/server/src/provider-runtime/runtime-status.ts` — 生成 `provider.runtimeStatus` 响应。
- Create: `packages/server/src/provider-runtime/install-manager.ts` — 生成 install plan、执行步骤、维护内存 job、归类失败原因。
- Create: `packages/server/src/__tests__/provider-runtime/command-check.test.ts` — 测 `where` / `which` 分支和命令可用性 helper。
- Create: `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts` — 测 provider runtime status 汇总。
- Create: `packages/server/src/__tests__/provider-runtime/install-manager.test.ts` — 测计划选择、前置安装、失败分类、job 复用。
- Create: `packages/server/src/commands/provider.ts` — 注册 `provider.runtimeStatus`、`provider.install.start`、`provider.install.get`。
- Modify: `packages/server/src/commands/index.ts` — 引入 provider commands。
- Modify: `packages/server/src/commands/session.ts` — 在 `session.create` 前执行 provider CLI 兜底校验。
- Modify: `packages/server/src/ws/dispatch.ts` — `CommandContext` 增加可选 `providerRuntimeDeps` / `providerInstallMgr`。
- Modify: `packages/server/src/server.ts` — 创建 `ProviderInstallManager` 并注入 command context。
- Modify: `packages/server/src/workspace/runtime-check.ts` — 复用新的命令探测 helper。
- Modify: `packages/server/src/__tests__/workspace/runtime-check.test.ts` — 更新为 helper 驱动的确定性测试。
- Modify: `packages/server/src/__tests__/session-commands.test.ts` — 覆盖 `provider_cli_missing`。
- Modify: `packages/server/src/__tests__/session-integration.test.ts` — 覆盖真实 `session.create` 兜底行为。
- Modify: `packages/web/src/ws/client.ts` — 保留服务端 command error 的 `code` / `details`。
- Modify: `packages/web/src/atoms/connection.ts` — `dispatchCommandAtom` 传递结构化错误。
- Modify: `packages/web/src/ws/__tests__/client.test.ts` — 覆盖结构化 command error 保留。
- Create: `packages/web/src/features/agent-panes/use-provider-launcher.ts` — `DraftLauncher` 的 runtime status / install job / launch 协调 hook。
- Modify: `packages/web/src/features/agent-panes/index.tsx` — UI 接入安装态、失败态、手动引导。
- Modify: `packages/web/src/features/agent-panes/index.test.tsx` — 覆盖 launcher 三态、安装并启动、失败回退。
- Modify: `packages/web/src/locales/zh.json` — 新增安装与失败文案。
- Modify: `packages/web/src/locales/en.json` — 同步英文文案。
- Modify: `packages/web/src/styles/components.css` — 为 provider 卡片增加 disabled / installing / failure / guide 区样式。

## Verification Baseline

```bash
cd /home/spencer/workspace/coder-studio
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/providers test
pnpm --filter @coder-studio/server test
pnpm --filter @coder-studio/web test
```

只在对应 task 影响到的包内跑最小测试；每完成一个 task 再补包级测试，最后跑上面的全量 baseline。

### Task 1: Core + Provider Install Metadata

**Files:**
- Modify: `packages/core/src/provider/definition.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/providers/src/claude/definition.ts`
- Modify: `packages/providers/src/codex/definition.ts`
- Modify: `packages/providers/src/claude/definition.test.ts`
- Modify: `packages/providers/src/codex/definition.test.ts`

- [ ] **Step 1: Write the failing provider metadata tests**

```ts
// packages/providers/src/claude/definition.test.ts
it('exposes Claude install metadata', () => {
  expect(claudeDefinition.install).toEqual({
    prerequisites: ['npm'],
    manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
    docUrls: {
      provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
      prerequisites: {
        npm: 'https://nodejs.org/en/download',
      },
    },
    strategies: {
      win32: [
        {
          id: 'winget-nodejs-lts',
          kind: 'prerequisite',
          targetCommand: 'npm',
          requiresCommands: ['winget'],
          command: 'winget',
          args: ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--silent'],
        },
        {
          id: 'npm-install-claude',
          kind: 'provider',
          targetCommand: 'claude',
          requiresCommands: ['npm'],
          command: 'npm',
          args: ['install', '-g', '@anthropic-ai/claude-code'],
        },
      ],
      darwin: [
        {
          id: 'brew-node',
          kind: 'prerequisite',
          targetCommand: 'npm',
          requiresCommands: ['brew'],
          command: 'brew',
          args: ['install', 'node'],
        },
        {
          id: 'npm-install-claude',
          kind: 'provider',
          targetCommand: 'claude',
          requiresCommands: ['npm'],
          command: 'npm',
          args: ['install', '-g', '@anthropic-ai/claude-code'],
        },
      ],
      linux: [
        {
          id: 'npm-install-claude',
          kind: 'provider',
          targetCommand: 'claude',
          requiresCommands: ['npm'],
          command: 'npm',
          args: ['install', '-g', '@anthropic-ai/claude-code'],
        },
      ],
    },
  });
});
```

```ts
// packages/providers/src/codex/definition.test.ts
it('exposes Codex install metadata', () => {
  expect(codexDefinition.install).toEqual({
    prerequisites: ['npm'],
    manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
    docUrls: {
      provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
      prerequisites: {
        npm: 'https://nodejs.org/en/download',
      },
    },
    strategies: {
      win32: [
        {
          id: 'winget-nodejs-lts',
          kind: 'prerequisite',
          targetCommand: 'npm',
          requiresCommands: ['winget'],
          command: 'winget',
          args: ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--silent'],
        },
        {
          id: 'npm-install-codex',
          kind: 'provider',
          targetCommand: 'codex',
          requiresCommands: ['npm'],
          command: 'npm',
          args: ['install', '-g', '@openai/codex'],
        },
      ],
      darwin: [
        {
          id: 'brew-node',
          kind: 'prerequisite',
          targetCommand: 'npm',
          requiresCommands: ['brew'],
          command: 'brew',
          args: ['install', 'node'],
        },
        {
          id: 'npm-install-codex',
          kind: 'provider',
          targetCommand: 'codex',
          requiresCommands: ['npm'],
          command: 'npm',
          args: ['install', '-g', '@openai/codex'],
        },
      ],
      linux: [
        {
          id: 'npm-install-codex',
          kind: 'provider',
          targetCommand: 'codex',
          requiresCommands: ['npm'],
          command: 'npm',
          args: ['install', '-g', '@openai/codex'],
        },
      ],
    },
  });
});
```

- [ ] **Step 2: Run the provider tests to verify they fail**

Run: `pnpm --filter @coder-studio/providers test -- definition.test.ts`

Expected: FAIL with `Property 'install' does not exist on type 'ProviderDefinition'`.

- [ ] **Step 3: Add shared install types in core and fill provider definitions**

```ts
// packages/core/src/provider/definition.ts
export interface ProviderInstallStrategy {
  id: string;
  kind: 'prerequisite' | 'provider';
  targetCommand: string;
  requiresCommands: string[];
  command: string;
  args: string[];
}

export interface ProviderInstallMetadata {
  prerequisites: string[];
  manualGuideKeys: string[];
  docUrls: {
    provider: string;
    prerequisites: Partial<Record<string, string>>;
  };
  strategies: Partial<Record<NodeJS.Platform, ProviderInstallStrategy[]>>;
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  badge: string;
  capability: 'full' | 'limited' | 'unsupported';
  buildCommand(config: ProviderConfig, ctx: LaunchContext): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };
  buildResumeCommand?(
    resumeId: string,
    config: ProviderConfig,
    ctx: LaunchContext
  ): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  } | null;
  buildSupervisorEvalCommand?(
    config: ProviderConfig,
    req: SupervisorEvalCommandRequest
  ): {
    argv: string[];
    outputFile?: string;
    cwd?: string;
    env?: Record<string, string>;
  } | null;
  readTranscriptExcerpt?(req: TranscriptExcerptRequest): Promise<{ excerpt: string; lastTurnId?: string } | null>;
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;
  requiredCommands: string[];
  install: ProviderInstallMetadata;
  hooks: HooksDescriptor;
  resolveTranscriptPath?(session: Session): Promise<string | null>;
}
```

```ts
// packages/core/src/domain/types.ts
export interface ProviderRuntimeStatusEntry {
  providerId: string;
  available: boolean;
  missingCommands: string[];
  missingPrerequisites: string[];
  autoInstallSupported: boolean;
  installReadiness: 'ready' | 'missing_prerequisite' | 'unsupported_platform';
  manualGuideKeys: string[];
  docUrls: {
    provider: string;
    prerequisites: Partial<Record<string, string>>;
  };
}

export interface ProviderRuntimeStatusResponse {
  providers: Record<string, ProviderRuntimeStatusEntry>;
}

export interface ProviderInstallStepSnapshot {
  id: string;
  titleKey: string;
  kind: 'check' | 'install' | 'verify';
  command: string;
  args: string[];
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export interface ProviderInstallFailure {
  code:
    | 'missing_prerequisite'
    | 'unsupported_platform'
    | 'permission_denied'
    | 'command_not_found'
    | 'command_failed'
    | 'verification_failed'
    | 'unknown_failure';
  providerId: string;
  failedStepId: string;
  message: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  missingCommands: string[];
  manualGuideKeys: string[];
  docUrls: {
    provider: string;
    prerequisites: Partial<Record<string, string>>;
  };
}

export interface ProviderInstallJobSnapshot {
  jobId: string;
  providerId: string;
  strategyIds: string[];
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  currentStepId?: string;
  steps: ProviderInstallStepSnapshot[];
  failure?: ProviderInstallFailure;
}
```

```ts
// packages/providers/src/claude/definition.ts
install: {
  prerequisites: ['npm'],
  manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
  docUrls: {
    provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
    prerequisites: {
      npm: 'https://nodejs.org/en/download',
    },
  },
  strategies: {
    win32: [
      {
        id: 'winget-nodejs-lts',
        kind: 'prerequisite',
        targetCommand: 'npm',
        requiresCommands: ['winget'],
        command: 'winget',
        args: ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--silent'],
      },
      {
        id: 'npm-install-claude',
        kind: 'provider',
        targetCommand: 'claude',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code'],
      },
    ],
    darwin: [
      {
        id: 'brew-node',
        kind: 'prerequisite',
        targetCommand: 'npm',
        requiresCommands: ['brew'],
        command: 'brew',
        args: ['install', 'node'],
      },
      {
        id: 'npm-install-claude',
        kind: 'provider',
        targetCommand: 'claude',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code'],
      },
    ],
    linux: [
      {
        id: 'npm-install-claude',
        kind: 'provider',
        targetCommand: 'claude',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code'],
      },
    ],
  },
},
```

```ts
// packages/providers/src/codex/definition.ts
install: {
  prerequisites: ['npm'],
  manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
  docUrls: {
    provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
    prerequisites: {
      npm: 'https://nodejs.org/en/download',
    },
  },
  strategies: {
    win32: [
      {
        id: 'winget-nodejs-lts',
        kind: 'prerequisite',
        targetCommand: 'npm',
        requiresCommands: ['winget'],
        command: 'winget',
        args: ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--silent'],
      },
      {
        id: 'npm-install-codex',
        kind: 'provider',
        targetCommand: 'codex',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@openai/codex'],
      },
    ],
    darwin: [
      {
        id: 'brew-node',
        kind: 'prerequisite',
        targetCommand: 'npm',
        requiresCommands: ['brew'],
        command: 'brew',
        args: ['install', 'node'],
      },
      {
        id: 'npm-install-codex',
        kind: 'provider',
        targetCommand: 'codex',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@openai/codex'],
      },
    ],
    linux: [
      {
        id: 'npm-install-codex',
        kind: 'provider',
        targetCommand: 'codex',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@openai/codex'],
      },
    ],
  },
},
```

- [ ] **Step 4: Export the new types and rerun core/provider tests**

```ts
// packages/core/src/index.ts
export * from './domain/types';
export * from './provider/definition';
```

Run: `pnpm --filter @coder-studio/core test && pnpm --filter @coder-studio/providers test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/provider/definition.ts \
  packages/core/src/domain/types.ts \
  packages/core/src/index.ts \
  packages/providers/src/claude/definition.ts \
  packages/providers/src/codex/definition.ts \
  packages/providers/src/claude/definition.test.ts \
  packages/providers/src/codex/definition.test.ts
git commit -m "feat: add provider install metadata contracts"
```

### Task 2: Shared Command Detection + Runtime Status Service

**Files:**
- Create: `packages/server/src/provider-runtime/command-check.ts`
- Create: `packages/server/src/provider-runtime/runtime-status.ts`
- Create: `packages/server/src/__tests__/provider-runtime/command-check.test.ts`
- Create: `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts`
- Modify: `packages/server/src/workspace/runtime-check.ts`
- Modify: `packages/server/src/__tests__/workspace/runtime-check.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
// packages/server/src/__tests__/provider-runtime/command-check.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  checkCommandAvailable,
  getCommandLookupExecutable,
} from '../../provider-runtime/command-check.js';

describe('getCommandLookupExecutable', () => {
  it('uses where on Windows', () => {
    expect(getCommandLookupExecutable('win32')).toBe('where');
  });

  it('uses which on darwin and linux', () => {
    expect(getCommandLookupExecutable('darwin')).toBe('which');
    expect(getCommandLookupExecutable('linux')).toBe('which');
  });
});

describe('checkCommandAvailable', () => {
  it('returns true when the lookup command succeeds', async () => {
    const execFile = vi.fn(async () => ({ stdout: '/usr/bin/codex\n', stderr: '' }));
    await expect(checkCommandAvailable('codex', { platform: 'linux', execFile })).resolves.toBe(true);
    expect(execFile).toHaveBeenCalledWith('which', ['codex']);
  });

  it('returns false when the lookup command fails', async () => {
    const execFile = vi.fn(async () => {
      throw new Error('not found');
    });
    await expect(checkCommandAvailable('claude', { platform: 'win32', execFile })).resolves.toBe(false);
    expect(execFile).toHaveBeenCalledWith('where', ['claude']);
  });
});
```

```ts
// packages/server/src/__tests__/provider-runtime/runtime-status.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildProviderRuntimeStatus } from '../../provider-runtime/runtime-status.js';
import { providerRegistry } from '@coder-studio/providers';

it('separates missing provider commands from missing prerequisites', async () => {
  const commandExists = vi.fn(async (command: string) => command === 'winget');

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: 'win32',
    commandExists,
  });

  expect(result.providers.codex).toMatchObject({
    available: false,
    missingCommands: ['codex'],
    missingPrerequisites: ['npm'],
    autoInstallSupported: true,
    installReadiness: 'missing_prerequisite',
  });
});
```

- [ ] **Step 2: Run the new server tests to verify they fail**

Run: `pnpm --filter @coder-studio/server test -- provider-runtime/command-check.test.ts provider-runtime/runtime-status.test.ts`

Expected: FAIL with missing module exports such as `getCommandLookupExecutable` and `buildProviderRuntimeStatus`.

- [ ] **Step 3: Implement the helper and runtime status builder**

```ts
// packages/server/src/provider-runtime/command-check.ts
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(nodeExecFile);

export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): 'where' | 'which' {
  return platform === 'win32' ? 'where' : 'which';
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {},
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const execFile = deps.execFile ?? ((file: string, args: string[]) => execFileAsync(file, args));
  const lookup = getCommandLookupExecutable(platform);

  try {
    await execFile(lookup, [command]);
    return true;
  } catch {
    return false;
  }
}
```

```ts
// packages/server/src/provider-runtime/runtime-status.ts
import type { ProviderDefinition, ProviderRuntimeStatusResponse } from '@coder-studio/core';
import {
  checkCommandAvailable,
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
} from './command-check.js';

export interface RuntimeStatusDeps extends CommandCheckDeps {
  commandExists?: CommandAvailabilityCheck;
}

function canAutoInstall(
  provider: ProviderDefinition,
  platform: NodeJS.Platform,
  missingCommands: string[],
  missingPrerequisites: string[],
): boolean {
  const strategies = provider.install.strategies[platform] ?? [];
  const remainingCommands = new Set(missingCommands);
  const remainingPrerequisites = new Set(missingPrerequisites);
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const strategy of strategies) {
      const requiresMet = strategy.requiresCommands.every(
        (command) =>
          !remainingPrerequisites.has(command) && !remainingCommands.has(command),
      );

      if (
        strategy.kind === 'prerequisite' &&
        remainingPrerequisites.has(strategy.targetCommand) &&
        requiresMet
      ) {
        remainingPrerequisites.delete(strategy.targetCommand);
        progressed = true;
        continue;
      }

      if (
        strategy.kind === 'provider' &&
        remainingCommands.has(strategy.targetCommand) &&
        requiresMet
      ) {
        remainingCommands.delete(strategy.targetCommand);
        progressed = true;
      }
    }
  }

  return remainingCommands.size === 0 && strategies.length > 0;
}

export async function buildProviderRuntimeStatus(
  providers: ProviderDefinition[],
  deps: RuntimeStatusDeps = {},
): Promise<ProviderRuntimeStatusResponse> {
  const platform = deps.platform ?? process.platform;
  const commandExists =
    deps.commandExists ??
    ((command: string) => checkCommandAvailable(command, deps));
  const result: ProviderRuntimeStatusResponse = { providers: {} };

  for (const provider of providers) {
    const missingCommands: string[] = [];
    for (const command of provider.requiredCommands) {
      if (!(await commandExists(command))) {
        missingCommands.push(command);
      }
    }

    const missingPrerequisites: string[] = [];
    for (const command of provider.install.prerequisites) {
      if (!(await commandExists(command))) {
        missingPrerequisites.push(command);
      }
    }

    const autoInstallSupported = canAutoInstall(
      provider,
      platform,
      missingCommands,
      missingPrerequisites,
    );

    result.providers[provider.id] = {
      providerId: provider.id,
      available: missingCommands.length === 0,
      missingCommands,
      missingPrerequisites,
      autoInstallSupported,
      installReadiness:
        missingPrerequisites.length === 0
          ? 'ready'
          : autoInstallSupported
            ? 'missing_prerequisite'
            : 'unsupported_platform',
      manualGuideKeys: provider.install.manualGuideKeys,
      docUrls: provider.install.docUrls,
    };
  }

  return result;
}
```

- [ ] **Step 4: Refactor workspace runtime check to reuse the helper and rerun tests**

```ts
// packages/server/src/workspace/runtime-check.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  checkCommandAvailable,
  type CommandAvailabilityCheck,
} from '../provider-runtime/command-check.js';

const execFileAsync = promisify(execFile);

export interface RuntimeCheckDeps {
  commandExists?: CommandAvailabilityCheck;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

async function checkGit(
  execRunner: RuntimeCheckDeps['execFile'],
): Promise<boolean> {
  try {
    const { stdout } = await (execRunner ?? ((file, args) => execFileAsync(file, args)))('git', ['--version']);
    return stdout.includes('git version');
  } catch {
    return false;
  }
}

async function checkNode(
  execRunner: RuntimeCheckDeps['execFile'],
): Promise<boolean> {
  try {
    const { stdout } = await (execRunner ?? ((file, args) => execFileAsync(file, args)))('node', ['--version']);
    return stdout.startsWith('v');
  } catch {
    return false;
  }
}

// inside runtimeCheck(...)
export async function runtimeCheck(
  _path: string,
  targetRuntime: TargetRuntime,
  deps: RuntimeCheckDeps = {},
): Promise<RuntimeCheckResult> {
  const commandExists =
    deps.commandExists ?? ((command: string) => checkCommandAvailable(command));

  const gitAvailable = await checkGit(deps.execFile);
  const nodeAvailable = await checkNode(deps.execFile);

  if (targetRuntime === 'wsl') {
    const wslAvailable = await commandExists('wsl');
  if (!wslAvailable) {
    missing.push('wsl');
  }
}
```

```ts
// packages/server/src/__tests__/workspace/runtime-check.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runtimeCheck } from '../../workspace/runtime-check.js';

it('reports missing wsl through the shared command helper', async () => {
  const execFile = vi.fn(async (file: string) => ({
    stdout: file === 'git' ? 'git version 2.48.0\n' : 'v22.15.0\n',
    stderr: '',
  }));

  const result = await runtimeCheck('/tmp', 'wsl', {
    commandExists: async (command) => command !== 'wsl',
    execFile,
  });

  expect(result).toEqual({ ok: false, missing: ['wsl'] });
});

it('reports missing git and node from the version checks deterministically', async () => {
  const result = await runtimeCheck('/tmp', 'native', {
    commandExists: async () => true,
    execFile: vi.fn(async (file: string) => {
      throw new Error(`${file} unavailable`);
    }),
  });

  expect(result).toEqual({ ok: false, missing: ['git', 'node'] });
});
```

Run: `pnpm --filter @coder-studio/server test -- provider-runtime/command-check.test.ts provider-runtime/runtime-status.test.ts workspace/runtime-check.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/provider-runtime/command-check.ts \
  packages/server/src/provider-runtime/runtime-status.ts \
  packages/server/src/workspace/runtime-check.ts \
  packages/server/src/__tests__/provider-runtime/command-check.test.ts \
  packages/server/src/__tests__/provider-runtime/runtime-status.test.ts \
  packages/server/src/__tests__/workspace/runtime-check.test.ts
git commit -m "feat(server): add provider runtime status checks"
```

### Task 3: In-Memory Install Manager With Failure Classification

**Files:**
- Create: `packages/server/src/provider-runtime/install-manager.ts`
- Create: `packages/server/src/__tests__/provider-runtime/install-manager.test.ts`

- [ ] **Step 1: Write failing install-manager tests**

```ts
// packages/server/src/__tests__/provider-runtime/install-manager.test.ts
import { describe, expect, it, vi } from 'vitest';
import { codexDefinition } from '@coder-studio/providers';
import { ProviderInstallManager } from '../../provider-runtime/install-manager.js';

it('builds a Windows plan that installs Node first when npm is missing', async () => {
  const commandExists = vi.fn(async (command: string) => command === 'winget');
  const manager = new ProviderInstallManager([codexDefinition], {
    platform: 'win32',
    commandExists,
    execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
  });

  const job = await manager.start('codex');

  expect(job.strategyIds).toEqual(['winget-nodejs-lts', 'npm-install-codex']);
  expect(job.steps.map((step) => step.id)).toEqual([
    'install-prerequisite-npm',
    'install-provider-codex',
    'verify-provider-codex',
  ]);
});

it('returns a failed job with missing_prerequisite when Linux has no npm', async () => {
  const commandExists = vi.fn(async () => false);
  const manager = new ProviderInstallManager([codexDefinition], {
    platform: 'linux',
    commandExists,
    execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
  });

  const job = await manager.start('codex');

  expect(job.status).toBe('failed');
  expect(job.failure).toMatchObject({
    code: 'missing_prerequisite',
    missingCommands: ['npm'],
  });
});

it('reuses the active job when the same provider is clicked twice', async () => {
  const pending = new Promise<{ stdout: string; stderr: string }>(() => {});
  const manager = new ProviderInstallManager([codexDefinition], {
    platform: 'darwin',
    commandExists: vi.fn(async (command: string) => command === 'npm'),
    execFile: vi.fn(() => pending),
  });

  const first = await manager.start('codex');
  const second = await manager.start('codex');

  expect(second.jobId).toBe(first.jobId);
});
```

- [ ] **Step 2: Run the install-manager tests to verify they fail**

Run: `pnpm --filter @coder-studio/server test -- provider-runtime/install-manager.test.ts`

Expected: FAIL with `Cannot find module '../../provider-runtime/install-manager.js'`.

- [ ] **Step 3: Implement the install manager**

```ts
// packages/server/src/provider-runtime/install-manager.ts
import { randomUUID } from 'node:crypto';
import type {
  ProviderDefinition,
  ProviderInstallFailure,
  ProviderInstallJobSnapshot,
  ProviderInstallStrategy,
  ProviderInstallStepSnapshot,
} from '@coder-studio/core';
import {
  checkCommandAvailable,
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
} from './command-check.js';

export interface InstallManagerDeps extends CommandCheckDeps {
  commandExists?: CommandAvailabilityCheck;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export class ProviderInstallManager {
  private readonly providers = new Map<string, ProviderDefinition>();
  private readonly jobs = new Map<string, ProviderInstallJobSnapshot>();
  private readonly activeProviderJobs = new Map<string, string>();

  constructor(providers: ProviderDefinition[], private readonly deps: InstallManagerDeps = {}) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  async start(providerId: string): Promise<ProviderInstallJobSnapshot> {
    const activeJobId = this.activeProviderJobs.get(providerId);
    if (activeJobId) {
      const activeJob = this.jobs.get(activeJobId);
      if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
        return activeJob;
      }
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw { code: 'unknown_provider', message: `Provider not found: ${providerId}` };
    }

    const prepared = await this.prepare(provider);
    this.jobs.set(prepared.job.jobId, prepared.job);
    this.activeProviderJobs.set(providerId, prepared.job.jobId);

    if (prepared.job.status === 'failed') {
      return prepared.job;
    }

    void this.runPreparedJob(provider, prepared.job, prepared.execSteps);
    return prepared.job;
  }

  get(jobId: string): ProviderInstallJobSnapshot | undefined {
    return this.jobs.get(jobId);
  }

  private async prepare(provider: ProviderDefinition): Promise<{
    job: ProviderInstallJobSnapshot;
    execSteps: Array<{ snapshotIndex: number; command: string; args: string[]; targetCommand: string }>;
  }> {
    const platform = this.deps.platform ?? process.platform;
    const strategies = provider.install.strategies[platform] ?? [];
    const missingProviderCommands = await this.collectMissing(provider.requiredCommands);
    const missingPrerequisites = await this.collectMissing(provider.install.prerequisites);
    const remainingProviderCommands = new Set(missingProviderCommands);
    const remainingPrerequisites = new Set(missingPrerequisites);

    if (missingProviderCommands.length === 0) {
      return {
        job: {
          jobId: randomUUID(),
          providerId: provider.id,
          strategyIds: [],
          status: 'succeeded',
          steps: [],
        },
        execSteps: [],
      };
    }

    const chosenStrategies: ProviderInstallStrategy[] = [];
    let progressed = true;

    while (progressed) {
      progressed = false;

      for (const strategy of strategies) {
        if (chosenStrategies.some((candidate) => candidate.id === strategy.id)) {
          continue;
        }

        const requiresMet = strategy.requiresCommands.every(
          (command) =>
            !remainingPrerequisites.has(command) &&
            !remainingProviderCommands.has(command),
        );

        if (
          strategy.kind === 'prerequisite' &&
          remainingPrerequisites.has(strategy.targetCommand) &&
          requiresMet
        ) {
          chosenStrategies.push(strategy);
          remainingPrerequisites.delete(strategy.targetCommand);
          progressed = true;
          continue;
        }

        if (
          strategy.kind === 'provider' &&
          remainingProviderCommands.has(strategy.targetCommand) &&
          requiresMet
        ) {
          chosenStrategies.push(strategy);
          remainingProviderCommands.delete(strategy.targetCommand);
          progressed = true;
        }
      }
    }

    if (remainingPrerequisites.size > 0) {
      return {
        job: {
          jobId: randomUUID(),
          providerId: provider.id,
          strategyIds: [],
          status: 'failed',
          steps: [],
          failure: {
            code: 'missing_prerequisite',
            providerId: provider.id,
            failedStepId: 'install-prerequisite-check',
            message: `Missing prerequisite commands: ${Array.from(remainingPrerequisites).join(', ')}`,
            command: '',
            args: [],
            missingCommands: Array.from(remainingPrerequisites),
            manualGuideKeys: provider.install.manualGuideKeys,
            docUrls: provider.install.docUrls,
          },
        },
        execSteps: [],
      };
    }

    if (remainingProviderCommands.size > 0) {
      return {
        job: {
          jobId: randomUUID(),
          providerId: provider.id,
          strategyIds: chosenStrategies.map((strategy) => strategy.id),
          status: 'failed',
          steps: [],
          failure: {
            code: 'unsupported_platform',
            providerId: provider.id,
            failedStepId: 'install-provider-check',
            message: `No install strategy can provide: ${Array.from(remainingProviderCommands).join(', ')}`,
            command: '',
            args: [],
            missingCommands: Array.from(remainingProviderCommands),
            manualGuideKeys: provider.install.manualGuideKeys,
            docUrls: provider.install.docUrls,
          },
        },
        execSteps: [],
      };
    }

    const stepSnapshots: ProviderInstallStepSnapshot[] = [];
    const execSteps: Array<{ snapshotIndex: number; command: string; args: string[]; targetCommand: string }> = [];

    for (const strategy of chosenStrategies) {
      const stepId = strategy.kind === 'prerequisite'
        ? `install-prerequisite-${strategy.targetCommand}`
        : `install-provider-${provider.id}`;
      stepSnapshots.push({
        id: stepId,
        titleKey: `provider.install.step.${stepId}`,
        kind: 'install',
        command: strategy.command,
        args: strategy.args,
        status: 'pending',
      });
      execSteps.push({
        snapshotIndex: stepSnapshots.length - 1,
        command: strategy.command,
        args: strategy.args,
        targetCommand: strategy.targetCommand,
      });
    }

    stepSnapshots.push({
      id: `verify-provider-${provider.id}`,
      titleKey: `provider.install.step.verify-provider-${provider.id}`,
      kind: 'verify',
      command: provider.requiredCommands[0]!,
      args: ['--version'],
      status: 'pending',
    });

    execSteps.push({
      snapshotIndex: stepSnapshots.length - 1,
      command: provider.requiredCommands[0]!,
      args: ['--version'],
      targetCommand: provider.requiredCommands[0]!,
    });

    return {
      job: {
        jobId: randomUUID(),
        providerId: provider.id,
        strategyIds: chosenStrategies.map((strategy) => strategy.id),
        status: 'queued',
        steps: stepSnapshots,
      },
      execSteps,
    };
  }

  private async runPreparedJob(
    provider: ProviderDefinition,
    job: ProviderInstallJobSnapshot,
    execSteps: Array<{ snapshotIndex: number; command: string; args: string[]; targetCommand: string }>,
  ): Promise<void> {
    job.status = 'running';
    for (const step of execSteps) {
      const snapshot = job.steps[step.snapshotIndex]!;
      job.currentStepId = snapshot.id;
      snapshot.status = 'running';
      snapshot.startedAt = Date.now();

      try {
        if (snapshot.kind === 'verify') {
          const commandExists =
            this.deps.commandExists ??
            ((command: string) => checkCommandAvailable(command, this.deps));
          const exists = await commandExists(step.targetCommand);
          if (!exists) {
            throw this.createFailure(provider, snapshot, 'verification_failed', 'Installed command is still not visible in PATH');
          }
          snapshot.status = 'succeeded';
          snapshot.finishedAt = Date.now();
          continue;
        }

        const execFile = this.deps.execFile!;
        const result = await execFile(step.command, step.args);
        snapshot.status = 'succeeded';
        snapshot.finishedAt = Date.now();
        snapshot.exitCode = 0;
        snapshot.stdoutExcerpt = result.stdout.slice(-500);
        snapshot.stderrExcerpt = result.stderr.slice(-500);
      } catch (error) {
        snapshot.status = 'failed';
        snapshot.finishedAt = Date.now();
        const failure = this.normalizeFailure(provider, snapshot, error);
        job.status = 'failed';
        job.failure = failure;
        this.activeProviderJobs.delete(provider.id);
        return;
      }
    }

    job.status = 'succeeded';
    job.currentStepId = undefined;
    this.activeProviderJobs.delete(provider.id);
  }

  private async collectMissing(commands: string[]): Promise<string[]> {
    const commandExists =
      this.deps.commandExists ??
      ((command: string) => checkCommandAvailable(command, this.deps));
    const missing: string[] = [];
    for (const command of commands) {
      if (!(await commandExists(command))) {
        missing.push(command);
      }
    }
    return missing;
  }

  private normalizeFailure(
    provider: ProviderDefinition,
    step: ProviderInstallStepSnapshot,
    error: unknown,
  ): ProviderInstallFailure {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return error as ProviderInstallFailure;
    }

    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    const code =
      lowered.includes('eacces') || lowered.includes('eperm')
        ? 'permission_denied'
        : lowered.includes('not found') || lowered.includes('enoent')
          ? 'command_not_found'
          : 'command_failed';

    return {
      code,
      providerId: provider.id,
      failedStepId: step.id,
      message,
      command: step.command,
      args: step.args,
      missingCommands: [],
      manualGuideKeys: provider.install.manualGuideKeys,
      docUrls: provider.install.docUrls,
      stdoutExcerpt: step.stdoutExcerpt,
      stderrExcerpt: step.stderrExcerpt,
    };
  }

  private createFailure(
    provider: ProviderDefinition,
    step: ProviderInstallStepSnapshot,
    code: ProviderInstallFailure['code'],
    message: string,
  ): ProviderInstallFailure {
    return {
      code,
      providerId: provider.id,
      failedStepId: step.id,
      message,
      command: step.command,
      args: step.args,
      missingCommands: [step.command],
      manualGuideKeys: provider.install.manualGuideKeys,
      docUrls: provider.install.docUrls,
    };
  }
}
```

- [ ] **Step 4: Run the install-manager tests and fix any signature drift**

Run: `pnpm --filter @coder-studio/server test -- provider-runtime/install-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/provider-runtime/install-manager.ts \
  packages/server/src/__tests__/provider-runtime/install-manager.test.ts
git commit -m "feat(server): add provider install manager"
```

### Task 4: Provider Commands + Session Guard + Server Wiring

**Files:**
- Create: `packages/server/src/commands/provider.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/commands/session.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/__tests__/session-commands.test.ts`
- Modify: `packages/server/src/__tests__/session-integration.test.ts`

- [ ] **Step 1: Write the failing command and guard tests**

```ts
// packages/server/src/__tests__/session-commands.test.ts
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { providerRegistry } from '@coder-studio/providers';
import '../commands/provider.js';

it('returns provider_cli_missing before terminal spawn when the CLI is absent', async () => {
  const testDir = join(tmpdir(), `coder-studio-session-command-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  ctx.providerRegistry = providerRegistry as any;
  ctx.providerRuntimeDeps = {
    commandExists: async (command) => command !== 'claude',
  } as any;

  const openResult = await dispatch(
    {
      kind: 'command',
      id: 'workspace-id',
      op: 'workspace.open',
      args: { path: '/tmp' },
    },
    ctx,
  );

  const result = await dispatch(
    {
      kind: 'command',
      id: 'session-id',
      op: 'session.create',
      args: {
        workspaceId: openResult.data!.id,
        providerId: 'claude',
      },
    },
    ctx,
  );

  expect(result.ok).toBe(false);
  expect(result.error).toEqual({
    code: 'provider_cli_missing',
    message: 'Provider CLI is not installed',
    details: {
      providerId: 'claude',
      missingCommands: ['claude'],
    },
  });

  rmSync(testDir, { recursive: true, force: true });
});
```

```ts
// packages/server/src/__tests__/session-integration.test.ts
import { ProviderInstallManager } from '../provider-runtime/install-manager.js';
import '../commands/provider.js';

it('exposes provider.runtimeStatus and provider.install.get via dispatch', async () => {
  ctx.providerRuntimeDeps = {
    commandExists: async (command) => command === 'winget',
  } as any;
  ctx.providerInstallMgr = new ProviderInstallManager(providerRegistry, {
    platform: 'win32',
    commandExists: async (command) => command === 'winget',
    execFile: async () => ({ stdout: '', stderr: '' }),
  }) as any;

  const status = await dispatch(
    {
      kind: 'command',
      id: 'provider-status',
      op: 'provider.runtimeStatus',
      args: {},
    },
    ctx,
  );

  expect(status.ok).toBe(true);
  expect(status.data).toHaveProperty('providers');

  const start = await dispatch(
    {
      kind: 'command',
      id: 'install-start',
      op: 'provider.install.start',
      args: { providerId: 'codex' },
    },
    ctx,
  );

  expect(start.ok).toBe(true);
  expect(start.data?.providerId).toBe('codex');

  const get = await dispatch(
    {
      kind: 'command',
      id: 'install-get',
      op: 'provider.install.get',
      args: { jobId: start.data!.jobId },
    },
    ctx,
  );

  expect(get.ok).toBe(true);
  expect(get.data?.jobId).toBe(start.data!.jobId);
});
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `pnpm --filter @coder-studio/server test -- session-commands.test.ts session-integration.test.ts`

Expected: FAIL with `Cannot find module '../commands/provider.js'` and missing `providerRuntimeDeps` / `providerInstallMgr` context.

- [ ] **Step 3: Add provider commands and wire the install manager into command context**

```ts
// packages/server/src/commands/provider.ts
import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import { buildProviderRuntimeStatus } from '../provider-runtime/runtime-status.js';

registerCommand(
  'provider.runtimeStatus',
  z.object({}),
  async (_args, ctx) => {
    return buildProviderRuntimeStatus(ctx.providerRegistry, ctx.providerRuntimeDeps);
  },
);

registerCommand(
  'provider.install.start',
  z.object({
    providerId: z.string(),
  }),
  async (args, ctx) => {
    if (!ctx.providerInstallMgr) {
      throw new Error('Provider install manager not configured');
    }
    return ctx.providerInstallMgr.start(args.providerId);
  },
);

registerCommand(
  'provider.install.get',
  z.object({
    jobId: z.string(),
  }),
  async (args, ctx) => {
    if (!ctx.providerInstallMgr) {
      throw new Error('Provider install manager not configured');
    }
    const job = ctx.providerInstallMgr.get(args.jobId);
    if (!job) {
      throw { code: 'provider_install_job_not_found', message: `Install job not found: ${args.jobId}` };
    }
    return job;
  },
);
```

```ts
// packages/server/src/ws/dispatch.ts
import type { ProviderInstallManager } from '../provider-runtime/install-manager.js';
import type { RuntimeStatusDeps } from '../provider-runtime/runtime-status.js';

export interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  hooksMgr: HooksManager;
  eventBus: EventBus;
  broadcaster: Broadcaster;
  db: Database;
  providerRegistry: ProviderDefinition[];
  fencingMgr: FencingManager;
  supervisorMgr: SupervisorManager;
  providerRuntimeDeps?: RuntimeStatusDeps;
  providerInstallMgr?: ProviderInstallManager;
}
```

```ts
// packages/server/src/commands/index.ts
import './provider.js';
```

```ts
// packages/server/src/server.ts
import { ProviderInstallManager } from './provider-runtime/install-manager.js';
import type { RuntimeStatusDeps } from './provider-runtime/runtime-status.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const providerRuntimeDeps: RuntimeStatusDeps = {};
const providerInstallMgr = new ProviderInstallManager(providerRegistry, {
  ...providerRuntimeDeps,
  execFile: (file, args) => execFileAsync(file, args),
});

const commandContext: CommandContext = {
  workspaceMgr,
  sessionMgr,
  terminalMgr,
  hooksMgr,
  eventBus,
  broadcaster: wsHub,
  db,
  providerRegistry,
  fencingMgr,
  supervisorMgr,
  providerRuntimeDeps,
  providerInstallMgr,
};
```

- [ ] **Step 4: Guard `session.create` with runtime status before terminal creation**

```ts
// packages/server/src/commands/session.ts
import { buildProviderRuntimeStatus } from '../provider-runtime/runtime-status.js';

registerCommand(
  'session.create',
  z.object({
    workspaceId: z.string(),
    providerId: z.string(),
    draft: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const provider = ctx.providerRegistry.find((candidate) => candidate.id === args.providerId);
    if (!provider) {
      throw { code: 'unknown_provider', message: `Provider not found: ${args.providerId}` };
    }

    const runtimeStatus = await buildProviderRuntimeStatus([provider], ctx.providerRuntimeDeps);
    const providerStatus = runtimeStatus.providers[provider.id];
    if (!providerStatus.available) {
      throw {
        code: 'provider_cli_missing',
        message: 'Provider CLI is not installed',
        details: {
          providerId: provider.id,
          missingCommands: providerStatus.missingCommands,
        },
      };
    }

    return ctx.sessionMgr.create({
      workspaceId: args.workspaceId,
      workspacePath: workspace.path,
      providerId: args.providerId,
      provider,
      draft: args.draft,
    });
  },
);
```

- [ ] **Step 5: Rerun tests and commit**

Run: `pnpm --filter @coder-studio/server test -- session-commands.test.ts session-integration.test.ts`

Expected: PASS.

```bash
git add packages/server/src/commands/provider.ts \
  packages/server/src/commands/index.ts \
  packages/server/src/commands/session.ts \
  packages/server/src/ws/dispatch.ts \
  packages/server/src/server.ts \
  packages/server/src/__tests__/session-commands.test.ts \
  packages/server/src/__tests__/session-integration.test.ts
git commit -m "feat(server): add provider install commands and session guard"
```

### Task 5: Web Command Errors + Draft Launcher Install Flow

**Files:**
- Modify: `packages/web/src/ws/client.ts`
- Modify: `packages/web/src/atoms/connection.ts`
- Modify: `packages/web/src/ws/__tests__/client.test.ts`
- Create: `packages/web/src/features/agent-panes/use-provider-launcher.ts`
- Modify: `packages/web/src/features/agent-panes/index.tsx`
- Modify: `packages/web/src/features/agent-panes/index.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing client + launcher tests**

```ts
// packages/web/src/ws/__tests__/client.test.ts
it('preserves command error code and details when the server rejects a command', async () => {
  const { client, socket } = createConnectedClient();
  const promise = client.sendCommand('provider.install.start', { providerId: 'codex' });

  socket.receiveJson({
    kind: 'result',
    id: socket.lastCommandId!,
    ok: false,
    error: {
      code: 'provider_cli_missing',
      message: 'Provider CLI is not installed',
      details: {
        providerId: 'codex',
        missingCommands: ['codex'],
      },
    },
  });

  await expect(promise).rejects.toMatchObject({
    code: 'provider_cli_missing',
    details: {
      providerId: 'codex',
      missingCommands: ['codex'],
    },
  });
});
```

```ts
// packages/web/src/features/agent-panes/index.test.tsx
import { localeAtom } from '../../atoms/ui';

it('shows install and start CTA when the provider is missing but auto-install is supported', async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === 'session.list') return [];
    if (op === 'provider.runtimeStatus') {
      return {
        providers: {
          claude: {
            providerId: 'claude',
            available: false,
            missingCommands: ['claude'],
            missingPrerequisites: [],
            autoInstallSupported: true,
            installReadiness: 'ready',
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
            docUrls: {
              provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
          codex: {
            providerId: 'codex',
            available: true,
            missingCommands: [],
            missingPrerequisites: [],
            autoInstallSupported: true,
            installReadiness: 'ready',
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
            docUrls: {
              provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
        },
      };
    }
    return undefined;
  });

  const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
  store.set(sessionsAtom, {});
  store.set(localeAtom, 'en');
  store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

  render(
    <Provider store={store}>
      <AgentPanes />
    </Provider>,
  );

  expect(await screen.findByText('Install & Start')).toBeInTheDocument();
});

it('runs install polling and creates the session after install succeeds', async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === 'session.list') return [];
    if (op === 'provider.runtimeStatus') {
      return {
        providers: {
          codex: {
            providerId: 'codex',
            available: false,
            missingCommands: ['codex'],
            missingPrerequisites: [],
            autoInstallSupported: true,
            installReadiness: 'ready',
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
            docUrls: {
              provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
          claude: {
            providerId: 'claude',
            available: true,
            missingCommands: [],
            missingPrerequisites: [],
            autoInstallSupported: true,
            installReadiness: 'ready',
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
            docUrls: {
              provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
        },
      };
    }
    if (op === 'provider.install.start') {
      return {
        jobId: 'job-1',
        providerId: 'codex',
        strategyIds: ['npm-install-codex'],
        status: 'running',
        currentStepId: 'install-provider-codex',
        steps: [],
      };
    }
    if (op === 'provider.install.get') {
      return {
        jobId: 'job-1',
        providerId: 'codex',
        strategyIds: ['npm-install-codex'],
        status: 'succeeded',
        steps: [],
      };
    }
    if (op === 'session.create') {
      return {
        id: 'sess_new',
        workspaceId: 'ws-1',
        terminalId: 'term-new',
        providerId: 'codex',
        state: 'starting',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      };
    }
    return undefined;
  });

  const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
  store.set(sessionsAtom, {});
  store.set(localeAtom, 'en');
  store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

  render(
    <Provider store={store}>
      <AgentPanes />
    </Provider>,
  );

  fireEvent.click((await screen.findByText('Install & Start')).closest('button')!);

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith('provider.install.start', { providerId: 'codex' });
  });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith('provider.install.get', { jobId: 'job-1' });
  });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith('session.create', {
      workspaceId: 'ws-1',
      providerId: 'codex',
    });
  });
});

it('shows install failure details and docs link when automatic install fails', async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === 'session.list') return [];
    if (op === 'provider.runtimeStatus') {
      return {
        providers: {
          claude: {
            providerId: 'claude',
            available: true,
            missingCommands: [],
            missingPrerequisites: [],
            autoInstallSupported: true,
            installReadiness: 'ready',
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
            docUrls: {
              provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
          codex: {
            providerId: 'codex',
            available: false,
            missingCommands: ['codex'],
            missingPrerequisites: ['npm'],
            autoInstallSupported: true,
            installReadiness: 'missing_prerequisite',
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
            docUrls: {
              provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
        },
      };
    }
    if (op === 'provider.install.start') {
      return {
        jobId: 'job-failed',
        providerId: 'codex',
        strategyIds: ['winget-nodejs-lts'],
        status: 'running',
        currentStepId: 'install-prerequisite-npm',
        steps: [],
      };
    }
    if (op === 'provider.install.get') {
      return {
        jobId: 'job-failed',
        providerId: 'codex',
        strategyIds: ['winget-nodejs-lts'],
        status: 'failed',
        steps: [],
        failure: {
          code: 'missing_prerequisite',
          providerId: 'codex',
          failedStepId: 'install-prerequisite-check',
          message: 'Missing prerequisite commands: npm',
          command: '',
          args: [],
          missingCommands: ['npm'],
          manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
          docUrls: {
            provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
            prerequisites: { npm: 'https://nodejs.org/en/download' },
          },
        },
      };
    }
    return undefined;
  });

  const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
  store.set(sessionsAtom, {});
  store.set(localeAtom, 'en');
  store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

  render(
    <Provider store={store}>
      <AgentPanes />
    </Provider>,
  );

  fireEvent.click((await screen.findByText('Install & Start')).closest('button')!);

  expect(await screen.findByText('Missing prerequisite commands: npm')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open official docs' })).toHaveAttribute(
    'href',
    'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
  );
});
```

- [ ] **Step 2: Run the web tests to verify they fail**

Run: `pnpm --filter @coder-studio/web test -- src/ws/__tests__/client.test.ts src/features/agent-panes/index.test.tsx`

Expected: FAIL because `sendCommand` rejects a plain `Error` without `code`, and the launcher has no install CTA.

- [ ] **Step 3: Preserve structured command errors in the web client**

```ts
// packages/web/src/ws/client.ts
export class CommandResultError extends Error {
  code: string;
  details?: unknown;

  constructor(error: { code: string; message: string; details?: unknown }) {
    super(error.message);
    this.name = 'CommandResultError';
    this.code = error.code;
    this.details = error.details;
  }
}

// inside handleMessage(...)
if (msg.ok) {
  pending.resolve(msg.data);
} else {
  pending.reject(new CommandResultError({
    code: msg.error?.code ?? 'command_failed',
    message: msg.error?.message ?? 'Command failed',
    details: msg.error?.details,
  }));
}
```

```ts
// packages/web/src/atoms/connection.ts
import { CommandResultError } from '../ws/client';

export const dispatchCommandAtom = atom<DispatchCommand>((get) => {
  const client = get(wsClientAtom);

  return async <T = unknown>(op: string, args: unknown): Promise<CommandResult<T>> => {
    if (!client) {
      return {
        ok: false,
        error: { code: 'no_client', message: 'WebSocket client not initialized' },
      };
    }

    try {
      const data = await client.sendCommand<T>(op, args);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof CommandResultError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: 'command_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  };
});
```

- [ ] **Step 4: Add the launcher hook and wire DraftLauncher UI**

```ts
// packages/web/src/features/agent-panes/use-provider-launcher.ts
import { useEffect, useRef, useState } from 'react';
import type {
  ProviderInstallJobSnapshot,
  ProviderRuntimeStatusEntry,
  ProviderRuntimeStatusResponse,
  Session,
} from '@coder-studio/core';
import type { DispatchCommand } from '../../atoms/connection';

type ProviderId = 'claude' | 'codex';

export interface ProviderCardState {
  runtime?: ProviderRuntimeStatusEntry;
  installJob?: ProviderInstallJobSnapshot;
  inlineError?: string;
  loading: boolean;
}

export function useProviderLauncher(
  dispatch: DispatchCommand,
  workspaceId: string,
  onSessionCreated: (session: Session, providerId: ProviderId) => void,
) {
  const [states, setStates] = useState<Record<ProviderId, ProviderCardState>>({
    claude: { loading: true },
    codex: { loading: true },
  });
  const pollingTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      const result = await dispatch<ProviderRuntimeStatusResponse>('provider.runtimeStatus', {});
      if (!result.ok || !result.data || cancelled) {
        return;
      }
      setStates({
        claude: { runtime: result.data.providers.claude, loading: false },
        codex: { runtime: result.data.providers.codex, loading: false },
      });
    };

    void loadStatus();
    return () => {
      cancelled = true;
      for (const timer of Object.values(pollingTimers.current)) {
        window.clearTimeout(timer);
      }
    };
  }, [dispatch]);

  const refreshStatus = async () => {
    const result = await dispatch<ProviderRuntimeStatusResponse>('provider.runtimeStatus', {});
    if (result.ok && result.data) {
      setStates((prev) => ({
        claude: { ...prev.claude, runtime: result.data.providers.claude, loading: false },
        codex: { ...prev.codex, runtime: result.data.providers.codex, loading: false },
      }));
    }
  };

  const launch = async (providerId: ProviderId) => {
    const runtime = states[providerId].runtime;
    if (!runtime) return;

    if (runtime.available) {
      const createResult = await dispatch<Session>('session.create', { workspaceId, providerId });
      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
        return;
      }
      if (createResult.error?.code === 'provider_cli_missing') {
        await refreshStatus();
      }
      setStates((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], inlineError: createResult.error?.message, loading: false },
      }));
      return;
    }

    if (!runtime.autoInstallSupported) {
      setStates((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], inlineError: 'manual' },
      }));
      return;
    }

    const startResult = await dispatch<ProviderInstallJobSnapshot>('provider.install.start', { providerId });
    if (!startResult.ok || !startResult.data) {
      setStates((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], inlineError: startResult.error?.message, loading: false },
      }));
      return;
    }

    setStates((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], installJob: startResult.data, loading: false },
    }));

    const poll = async () => {
      const jobResult = await dispatch<ProviderInstallJobSnapshot>('provider.install.get', { jobId: startResult.data!.jobId });
      if (!jobResult.ok || !jobResult.data) {
        return;
      }

      setStates((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], installJob: jobResult.data, inlineError: undefined, loading: false },
      }));

      if (jobResult.data.status === 'running' || jobResult.data.status === 'queued') {
        pollingTimers.current[providerId] = window.setTimeout(poll, 1500);
        return;
      }

      if (jobResult.data.status === 'failed') {
        setStates((prev) => ({
          ...prev,
          [providerId]: {
            ...prev[providerId],
            installJob: jobResult.data,
            inlineError: jobResult.data.failure?.message,
            loading: false,
          },
        }));
        return;
      }

      await refreshStatus();
      const createResult = await dispatch<Session>('session.create', { workspaceId, providerId });
      if (createResult.ok && createResult.data) {
        onSessionCreated(createResult.data, providerId);
      }
    };

    pollingTimers.current[providerId] = window.setTimeout(poll, 1500);
  };

  return { states, launch };
}
```

```tsx
// packages/web/src/features/agent-panes/index.tsx
const { states, launch } = useProviderLauncher(dispatch, workspaceId, (session) => {
  setSessions((prev) => ({ ...prev, [session.id]: session }));
  setPaneLayout((current) =>
    paneId
      ? assignSessionToPane(current, paneId, session.id)
      : { id: 'root', type: 'leaf', sessionId: session.id },
  );
});

const renderProviderCta = (provider: 'claude' | 'codex') => {
  const state = states[provider];
  if (state.installJob && (state.installJob.status === 'queued' || state.installJob.status === 'running')) {
    return t('provider.install.cta.installing');
  }
  if (state.runtime?.available) {
    return t('provider.install.cta.start');
  }
  if (state.runtime?.autoInstallSupported) {
    return t('provider.install.cta.install_and_start');
  }
  return t('provider.install.cta.manual');
};

const getManualMessageKey = (provider: 'claude' | 'codex') =>
  provider === 'claude'
    ? 'provider.install.manual.nodejs_then_claude'
    : 'provider.install.manual.nodejs_then_codex';
```

```tsx
// inside each provider card body in packages/web/src/features/agent-panes/index.tsx
{states.claude.installJob?.status === 'running' && (
  <span className="agent-provider-card-status">
    {t('provider.install.status.installing')}
  </span>
)}
{(states.claude.inlineError || states.claude.installJob?.failure) && (
  <div className="agent-provider-card-guide">
    <p>
      {states.claude.installJob?.failure?.message ??
        (states.claude.inlineError === 'manual'
          ? t(getManualMessageKey('claude'))
          : states.claude.inlineError)}
    </p>
    <a
      href={states.claude.installJob?.failure?.docUrls.provider ?? states.claude.runtime?.docUrls.provider}
      target="_blank"
      rel="noreferrer"
    >
      {t('provider.install.open_docs')}
    </a>
  </div>
)}
```

- [ ] **Step 5: Add i18n, styles, rerun web tests, and commit**

```json
// packages/web/src/locales/en.json
{
  "provider": {
    "install": {
      "cta": {
        "start": "Start Session",
        "install_and_start": "Install & Start",
        "installing": "Installing…",
        "manual": "View Install Steps"
      },
      "status": {
        "installing": "Installing provider CLI…",
        "failed": "Automatic install failed"
      },
      "open_docs": "Open official docs",
      "manual": {
        "nodejs_then_claude": "Install Node.js 18+ first, then run npm install -g @anthropic-ai/claude-code.",
        "nodejs_then_codex": "Install Node.js first, then run npm install -g @openai/codex.",
        "nodejs": "Install Node.js from the official download page."
      }
    }
  }
}
```

```json
// packages/web/src/locales/zh.json
{
  "provider": {
    "install": {
      "cta": {
        "start": "启动会话",
        "install_and_start": "安装并启动",
        "installing": "安装中…",
        "manual": "查看安装步骤"
      },
      "status": {
        "installing": "正在安装 Provider CLI…",
        "failed": "自动安装失败"
      },
      "open_docs": "打开官方文档",
      "manual": {
        "nodejs_then_claude": "请先安装 Node.js 18+，再执行 npm install -g @anthropic-ai/claude-code。",
        "nodejs_then_codex": "请先安装 Node.js，再执行 npm install -g @openai/codex。",
        "nodejs": "请先从 Node.js 官方下载页安装 Node.js。"
      }
    }
  }
}
```

```css
/* packages/web/src/styles/components.css */
.agent-provider-card[disabled] {
  opacity: 0.72;
  cursor: not-allowed;
}

.agent-provider-card-status {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.agent-provider-card-guide {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  color: var(--text-secondary);
}

.agent-provider-card-guide a {
  color: var(--accent);
  text-decoration: none;
}
```

Run: `pnpm --filter @coder-studio/web test -- src/ws/__tests__/client.test.ts src/features/agent-panes/index.test.tsx`

Expected: PASS.

```bash
git add packages/web/src/ws/client.ts \
  packages/web/src/atoms/connection.ts \
  packages/web/src/features/agent-panes/use-provider-launcher.ts \
  packages/web/src/features/agent-panes/index.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/locales/zh.json \
  packages/web/src/locales/en.json \
  packages/web/src/styles/components.css
git commit -m "feat(web): add provider install flow to draft launcher"
```

### Task 6: Final Cross-Package Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run focused package tests in dependency order**

Run:

```bash
cd /home/spencer/workspace/coder-studio
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/providers test
pnpm --filter @coder-studio/server test
pnpm --filter @coder-studio/web test
```

Expected: all suites PASS.

- [ ] **Step 2: Spot-check the launcher in dev mode**

Run:

```bash
cd /home/spencer/workspace/coder-studio
pnpm dev:server
pnpm dev:web
```

Manual checks:

- Open the no-session launcher and confirm it calls `provider.runtimeStatus`
- Verify an installed provider shows `Start Session`
- Verify an unavailable provider with auto-install support shows `Install & Start`
- Verify a failed install shows manual guidance and the provider docs link
- Verify the in-session draft pane matches the home launcher behavior

- [ ] **Step 3: Create the final verification commit if the package test reruns required any tiny fixes**

```bash
git status --short
git add -A
git commit -m "test: verify provider install flow end to end"
```

If no code changed during verification, skip the commit.

---

## Self-Review

### Spec Coverage

- 启动前 CLI 检查：Task 2 + Task 4
- `where` / `which` 平台分支：Task 2
- 自动安装计划：Task 1 + Task 3
- 安装前置缺失处理：Task 2 + Task 3
- 自动安装失败结构化原因：Task 3
- `session.create` 最终兜底：Task 4
- 两个 launcher 入口统一：Task 5
- 前端 i18n + 手动引导：Task 5

### Placeholder Scan

- 未使用 `TODO` / `TBD`
- 未使用省略命令或 `...`
- 所有代码步骤都给出了具体文件、具体片段、具体测试命令

### Type Consistency

- 后端和前端都使用 `ProviderRuntimeStatusResponse` / `ProviderInstallJobSnapshot` / `ProviderInstallFailure`
- `providerRuntimeDeps` / `providerInstallMgr` 都只作为 `CommandContext` 的可选扩展注入，不会强制改动所有旧测试夹具
- 轮询方案只使用 `provider.install.start` / `provider.install.get`，不引入额外 topic 命名
