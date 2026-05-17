import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CommandAvailabilityCheck, checkCommandAvailable } from "./command-check.js";
import { type CommandRunner, runCommandAsString } from "./command-runner.js";

type MockProviderId = "claude" | "codex";
type MockInstallResult = "success" | "permission_denied" | "command_not_found";

interface MockInstallBehavior {
  result: MockInstallResult;
  message?: string;
}

interface ProviderMockState {
  commands?: Partial<Record<string, boolean>>;
  installBehavior?: Partial<Record<MockProviderId, MockInstallBehavior>>;
}

interface ProviderMockOverrides {
  commandExists: CommandAvailabilityCheck;
  runCommand: CommandRunner;
}

const PROVIDER_INSTALL_PACKAGES: Record<MockProviderId, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

const PROVIDER_COMMAND_SCRIPTS: Record<MockProviderId, string> = {
  claude: `#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' TERM INT
printf 'Mock Claude ready\\n'
while true; do
  sleep 1
done
`,
  codex: `#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' TERM INT
printf 'Session ID: abcdef-123456\\n> '
while true; do
  sleep 1
done
`,
};

export function createE2EProviderMockOverrides(
  env: NodeJS.ProcessEnv = process.env
): ProviderMockOverrides | null {
  const statePath = env.CODER_STUDIO_E2E_PROVIDER_STATE_PATH;
  if (!statePath) {
    return null;
  }

  const binDir = env.CODER_STUDIO_E2E_PROVIDER_BIN_DIR;
  const debugLogPath = env.CODER_STUDIO_E2E_PROVIDER_DEBUG_LOG_PATH;

  appendDebugLog(debugLogPath, `init statePath=${statePath} binDir=${binDir ?? ""}`);

  const commandExists: CommandAvailabilityCheck = async (command: string) => {
    const state = readMockState(statePath);
    const override = state.commands?.[command];
    appendDebugLog(
      debugLogPath,
      `commandExists ${command} override=${String(override)} state=${JSON.stringify(state.commands ?? {})}`
    );

    if (typeof override === "boolean") {
      return override;
    }

    return checkCommandAvailable(command);
  };

  const runCommand: CommandRunner = async (file, args, options) => {
    const providerId = getInstallProviderId(file, args);
    appendDebugLog(
      debugLogPath,
      `runCommand ${file} ${args.join(" ")} provider=${providerId ?? "none"}`
    );
    if (!providerId) {
      return runCommandAsString(file, args, options);
    }

    const state = readMockState(statePath);
    const behavior = state.installBehavior?.[providerId];
    appendDebugLog(
      debugLogPath,
      `behavior ${providerId} ${JSON.stringify(behavior)} state=${JSON.stringify(state)}`
    );
    if (!behavior) {
      return runCommandAsString(file, args, options);
    }

    if (behavior.result === "success") {
      writeMockState(statePath, (draft) => {
        draft.commands ??= {};
        draft.commands[providerId] = true;
      });

      if (binDir) {
        ensureProviderCommand(binDir, providerId);
      }

      appendDebugLog(debugLogPath, `install success ${providerId}`);

      return {
        stdout: `installed ${providerId}`,
        stderr: "",
      };
    }

    const message =
      behavior.message ??
      (behavior.result === "permission_denied" ? "permission denied" : "command not found");

    throw Object.assign(new Error(message), {
      exitCode: 1,
      stdout: "",
      stderr: message,
    });
  };

  return {
    commandExists,
    runCommand,
  };
}

function getInstallProviderId(file: string, args: string[]): MockProviderId | null {
  if (file !== "npm" || args.length !== 3) {
    return null;
  }

  if (args[0] !== "install" || args[1] !== "-g") {
    return null;
  }

  const packageName = args[2];
  if (packageName === PROVIDER_INSTALL_PACKAGES.claude) {
    return "claude";
  }
  if (packageName === PROVIDER_INSTALL_PACKAGES.codex) {
    return "codex";
  }

  return null;
}
function readMockState(statePath: string): ProviderMockState {
  if (!existsSync(statePath)) {
    return {};
  }

  const raw = readFileSync(statePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as ProviderMockState;
  } catch (error) {
    throw new Error(
      `Invalid provider mock state at ${statePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function writeMockState(
  statePath: string,
  updater: (state: ProviderMockState) => void
): ProviderMockState {
  const nextState = readMockState(statePath);
  updater(nextState);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

function ensureProviderCommand(binDir: string, providerId: MockProviderId): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, providerId);
  writeFileSync(scriptPath, PROVIDER_COMMAND_SCRIPTS[providerId], "utf8");
  chmodSync(scriptPath, 0o755);
}

function appendDebugLog(path: string | undefined, line: string): void {
  if (!path) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${line}\n`, { flag: "a" });
}
