import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  LspServerKind,
  LspToolInstallFailure,
  LspToolInstallJobSnapshot,
  LspToolInstallStepSnapshot,
  Workspace,
} from "@coder-studio/core";
import {
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";
import {
  getLspToolDefinition,
  getManagedPrerequisites,
  resolveManagedPythonCommand,
  VUE_LANGUAGE_SERVER_VERSION,
  VUE_TYPESCRIPT_VERSION,
} from "./definitions.js";
import { FileManifestStore } from "./manifest-store.js";

const EXCERPT_LIMIT = 400;

interface InstallPlanStep {
  id: string;
  title: string;
  kind: "install" | "verify";
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const PYTHON_MANAGED_VERSION = "1.14.0";
const RUST_ANALYZER_RELEASE_TAG = "2026-05-18";

export interface LspToolInstallManagerDeps extends CommandCheckDeps {
  manifestStore: FileManifestStore;
  commandExists?: CommandAvailabilityCheck;
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
}

export class LspToolInstallManager {
  private readonly jobs = new Map<string, LspToolInstallJobSnapshot>();
  private readonly activeJobIdsByServerKind = new Map<LspServerKind, string>();

  constructor(private readonly deps: LspToolInstallManagerDeps) {}

  async start(input: {
    workspace: Workspace;
    serverKind: LspServerKind;
  }): Promise<LspToolInstallJobSnapshot> {
    const activeJob = this.getActiveJob(input.serverKind);
    if (activeJob) {
      return cloneJobSnapshot(activeJob);
    }

    const job = await this.prepare(input);
    this.jobs.set(job.jobId, job);

    if (job.status === "queued") {
      this.activeJobIdsByServerKind.set(input.serverKind, job.jobId);
      void this.runPreparedJob(input.serverKind, job);
    }

    return cloneJobSnapshot(job);
  }

  get(jobId: string): LspToolInstallJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    return job ? cloneJobSnapshot(job) : undefined;
  }

  private async prepare(input: {
    workspace: Workspace;
    serverKind: LspServerKind;
  }): Promise<LspToolInstallJobSnapshot> {
    const definition = getLspToolDefinition(input.serverKind);
    const managed = definition.managed;
    const jobId = randomUUID();
    const platform = this.deps.platform ?? process.platform;

    if (!managed || input.workspace.targetRuntime !== "native") {
      return {
        jobId,
        serverKind: input.serverKind,
        status: "failed",
        steps: [
          {
            id: `install-${input.serverKind}`,
            title: `Install ${definition.displayName}`,
            kind: "check",
            status: "failed",
            command: definition.defaultCommand,
            args: [],
          },
        ],
        failure: {
          code: "unsupported_platform",
          serverKind: input.serverKind,
          message: `Managed install is not supported for ${definition.displayName} in this workspace runtime`,
          failedStepId: `install-${input.serverKind}`,
          command: definition.defaultCommand,
          args: [],
          missingCommands: [definition.defaultCommand],
        },
      };
    }

    const commandExists =
      this.deps.commandExists ?? ((command: string) => checkCommandAvailable(command, this.deps));
    const missingPrerequisites: string[] = [];
    let pythonCommand: string | null = null;
    if (input.serverKind === "python") {
      pythonCommand = await resolveManagedPythonCommand(
        commandExists,
        platform,
        this.deps.runCommand
      );
      if (!pythonCommand) {
        missingPrerequisites.push(...getManagedPrerequisites("python", platform));
      }
    } else {
      for (const prerequisite of getManagedPrerequisites(input.serverKind, platform)) {
        if (!(await commandExists(prerequisite))) {
          missingPrerequisites.push(prerequisite);
        }
      }
    }

    if (missingPrerequisites.length > 0) {
      return {
        jobId,
        serverKind: input.serverKind,
        status: "failed",
        steps: [
          {
            id: `install-${input.serverKind}`,
            title: `Install ${definition.displayName}`,
            kind: "check",
            status: "failed",
            command: missingPrerequisites[0] ?? definition.defaultCommand,
            args: [],
          },
        ],
        failure: {
          code: "missing_prerequisite",
          serverKind: input.serverKind,
          message: `Missing prerequisites: ${missingPrerequisites.join(", ")}`,
          failedStepId: `install-${input.serverKind}`,
          command: missingPrerequisites[0] ?? definition.defaultCommand,
          args: [],
          missingCommands: missingPrerequisites,
        },
      };
    }

    const installRoot = join(this.deps.manifestStore.getRoot(), input.serverKind, managed.version);
    const executablePath = resolveManagedExecutablePath(input.serverKind, installRoot, platform);

    const plannedSteps = this.planInstallSteps({
      serverKind: input.serverKind,
      installRoot,
      executablePath,
      platform,
      pythonCommand,
      version: managed.version,
    });

    return {
      jobId,
      serverKind: input.serverKind,
      status: "queued",
      currentStepId: plannedSteps[0]?.id,
      steps: plannedSteps.map(toSnapshotStep),
    };
  }

  private async runPreparedJob(
    serverKind: LspServerKind,
    job: LspToolInstallJobSnapshot
  ): Promise<void> {
    const runCommand = this.deps.runCommand ?? runCommandAsString;
    const definition = getLspToolDefinition(serverKind);
    const managed = definition.managed;
    if (!managed) {
      return;
    }
    const platform = this.deps.platform ?? process.platform;

    job.status = "running";
    this.jobs.set(job.jobId, job);

    const installRoot = join(this.deps.manifestStore.getRoot(), serverKind, managed.version);
    const executablePath = resolveManagedExecutablePath(serverKind, installRoot, platform);

    const commandExists =
      this.deps.commandExists ?? ((command: string) => checkCommandAvailable(command, this.deps));
    const pythonCommand =
      serverKind === "python"
        ? await resolveManagedPythonCommand(commandExists, platform, this.deps.runCommand)
        : null;

    mkdirSync(dirname(executablePath), { recursive: true });

    for (const step of job.steps) {
      job.currentStepId = step.id;
      step.status = "running";
      step.startedAt = Date.now();
      this.jobs.set(job.jobId, job);

      try {
        const planned = this.planInstallSteps({
          serverKind,
          installRoot,
          executablePath,
          platform,
          pythonCommand,
          version: managed.version,
        }).find((candidate) => candidate.id === step.id);

        if (!planned) {
          throw new Error(`Install step not found: ${step.id}`);
        }

        if (step.kind === "verify") {
          const available = await commandExists(executablePath);
          if (!available) {
            throw Object.assign(new Error(`Verification failed for ${definition.displayName}`), {
              code: "VERIFY_FAILED",
            });
          }
        } else {
          const result = await runCommand(planned.command, planned.args, {
            windowsHide: true,
            cwd: planned.cwd,
            env: planned.env,
          });
          step.stdoutExcerpt = excerpt(result.stdout);
          step.stderrExcerpt = excerpt(result.stderr);
        }

        step.status = "succeeded";
        step.exitCode = 0;
        step.finishedAt = Date.now();
        this.jobs.set(job.jobId, job);
      } catch (error) {
        const details = getErrorDetails(error);
        step.status = "failed";
        step.finishedAt = Date.now();
        step.exitCode = details.exitCode;
        step.stdoutExcerpt = excerpt(details.stdout);
        step.stderrExcerpt = excerpt(details.stderr || details.message);
        job.status = "failed";
        job.failure = normalizeFailure(serverKind, step, error);
        this.clearActiveJob(serverKind, job.jobId);
        this.jobs.set(job.jobId, job);
        return;
      }
    }

    this.deps.manifestStore.write(serverKind, {
      serverKind,
      version: managed.version,
      executablePath,
      installedAt: Date.now(),
      source: "managed",
      platform,
    });

    job.status = "succeeded";
    job.currentStepId = undefined;
    this.clearActiveJob(serverKind, job.jobId);
    this.jobs.set(job.jobId, job);
  }

  private planInstallSteps(input: {
    serverKind: LspServerKind;
    installRoot: string;
    executablePath: string;
    platform: NodeJS.Platform;
    pythonCommand: string | null;
    version: string;
  }): InstallPlanStep[] {
    if (input.serverKind === "python") {
      const venvRoot = join(input.installRoot, "venv");
      const binDir = join(venvRoot, input.platform === "win32" ? "Scripts" : "bin");
      const pipPath = join(binDir, input.platform === "win32" ? "pip.exe" : "pip");
      return [
        {
          id: "create-python-venv",
          title: "Create Python virtual environment",
          kind: "install",
          command: input.pythonCommand ?? "python3",
          args: ["-m", "venv", venvRoot],
          cwd: input.installRoot,
        },
        {
          id: "install-python-lsp",
          title: "Install python-lsp-server",
          kind: "install",
          command: pipPath,
          args: ["install", `python-lsp-server==${PYTHON_MANAGED_VERSION}`],
          cwd: input.installRoot,
        },
        {
          id: "verify-python-lsp",
          title: "Verify python-lsp-server",
          kind: "verify",
          command: input.executablePath,
          args: ["--version"],
        },
      ];
    }

    if (input.serverKind === "go") {
      return [
        {
          id: "install-go-lsp",
          title: "Install gopls",
          kind: "install",
          command: "go",
          args: ["install", `golang.org/x/tools/gopls@${input.version}`],
          env: {
            ...process.env,
            GOBIN: join(input.installRoot, "bin"),
          },
        },
        {
          id: "verify-go-lsp",
          title: "Verify gopls",
          kind: "verify",
          command: input.executablePath,
          args: ["version"],
        },
      ];
    }

    if (input.serverKind === "vue") {
      return [
        {
          id: "install-vue-lsp",
          title: "Install Vue language server",
          kind: "install",
          command: "npm",
          args: [
            "install",
            "--no-save",
            `@vue/language-server@${VUE_LANGUAGE_SERVER_VERSION}`,
            `typescript@${VUE_TYPESCRIPT_VERSION}`,
          ],
          cwd: input.installRoot,
        },
        {
          id: "verify-vue-lsp",
          title: "Verify Vue language server",
          kind: "verify",
          command: input.executablePath,
          args: ["--version"],
        },
      ];
    }

    return [
      {
        id: "install-rust-lsp",
        title: "Install rust-analyzer",
        kind: "install",
        command: process.execPath,
        args: [
          "-e",
          buildRustAnalyzerInstallerScript({
            targetFile: input.executablePath,
            releaseTag: RUST_ANALYZER_RELEASE_TAG,
          }),
        ],
        cwd: input.installRoot,
      },
      {
        id: "verify-rust-lsp",
        title: "Verify rust-analyzer",
        kind: "verify",
        command: input.executablePath,
        args: ["--version"],
      },
    ];
  }

  private getActiveJob(serverKind: LspServerKind): LspToolInstallJobSnapshot | undefined {
    const activeJobId = this.activeJobIdsByServerKind.get(serverKind);
    if (!activeJobId) {
      return undefined;
    }

    const activeJob = this.jobs.get(activeJobId);
    if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
      return activeJob;
    }

    this.activeJobIdsByServerKind.delete(serverKind);
    return undefined;
  }

  private clearActiveJob(serverKind: LspServerKind, jobId: string): void {
    if (this.activeJobIdsByServerKind.get(serverKind) === jobId) {
      this.activeJobIdsByServerKind.delete(serverKind);
    }
  }
}

function resolveManagedExecutablePath(
  serverKind: LspServerKind,
  installRoot: string,
  platform: NodeJS.Platform
): string {
  if (serverKind === "python") {
    return join(
      installRoot,
      "venv",
      platform === "win32" ? "Scripts" : "bin",
      platform === "win32" ? "pylsp.exe" : "pylsp"
    );
  }

  if (serverKind === "go") {
    return join(installRoot, "bin", platform === "win32" ? "gopls.exe" : "gopls");
  }

  if (serverKind === "rust") {
    return join(installRoot, "bin", platform === "win32" ? "rust-analyzer.exe" : "rust-analyzer");
  }

  return join(
    installRoot,
    "node_modules",
    ".bin",
    platform === "win32" ? "vue-language-server.cmd" : "vue-language-server"
  );
}

function toSnapshotStep(step: InstallPlanStep): LspToolInstallStepSnapshot {
  return {
    id: step.id,
    title: step.title,
    kind: step.kind,
    status: "pending",
    command: step.command,
    args: step.args,
  };
}

function getErrorDetails(error: unknown): {
  message: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
} {
  if (error instanceof Error) {
    const record = error as Error & {
      code?: number | string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      message: error.message,
      exitCode:
        typeof record.exitCode === "number"
          ? record.exitCode
          : typeof record.code === "number"
            ? record.code
            : undefined,
      stdout: record.stdout ?? "",
      stderr: record.stderr ?? "",
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown install failure",
    stdout: "",
    stderr: "",
  };
}

function normalizeFailure(
  serverKind: LspServerKind,
  step: LspToolInstallStepSnapshot,
  error: unknown
): LspToolInstallFailure {
  const details = getErrorDetails(error);
  const haystack = `${details.message}\n${details.stderr}\n${details.stdout}`.toLowerCase();

  let code: LspToolInstallFailure["code"] = "command_failed";
  if (
    haystack.includes("permission denied") ||
    haystack.includes("eacces") ||
    haystack.includes("eperm")
  ) {
    code = "permission_denied";
  } else if (
    haystack.includes("not found") ||
    haystack.includes("is not recognized") ||
    haystack.includes("enoent")
  ) {
    code = "command_not_found";
  } else if (haystack.includes("verify")) {
    code = "verification_failed";
  }

  return {
    code,
    serverKind,
    message: details.message || `Install step failed: ${step.command}`,
    failedStepId: step.id,
    command: step.command,
    args: [...step.args],
    exitCode: details.exitCode,
    stdoutExcerpt: excerpt(details.stdout),
    stderrExcerpt: excerpt(details.stderr || details.message),
    missingCommands: [],
  };
}

function excerpt(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.slice(0, EXCERPT_LIMIT);
}

function cloneJobSnapshot(job: LspToolInstallJobSnapshot): LspToolInstallJobSnapshot {
  return {
    jobId: job.jobId,
    serverKind: job.serverKind,
    status: job.status,
    currentStepId: job.currentStepId,
    steps: job.steps.map((step) => ({
      ...step,
      args: [...step.args],
    })),
    failure: job.failure
      ? {
          ...job.failure,
          args: [...job.failure.args],
          missingCommands: [...job.failure.missingCommands],
        }
      : undefined,
  };
}

function buildRustAnalyzerInstallerScript(input: {
  targetFile: string;
  releaseTag: string;
}): string {
  const assetName = getRustAnalyzerAssetName(process.platform);
  const executableMode = process.platform === "win32" ? undefined : 0o755;

  return `
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const targetFile = ${JSON.stringify(input.targetFile)};
const releaseTag = ${JSON.stringify(input.releaseTag)};
const assetName = ${JSON.stringify(assetName)};
const executableMode = ${JSON.stringify(executableMode ?? null)};
const url = \`https://github.com/rust-lang/rust-analyzer/releases/download/\${releaseTag}/\${assetName}\`;

async function main() {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const response = await fetch(url, {
    headers: { "user-agent": "coder-studio-lsp-installer" },
  });

  if (!response.ok || !response.body) {
    throw new Error(\`Failed to download rust-analyzer (\${response.status})\`);
  }

  const chunks = [];
  for await (const chunk of response.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const archive = Buffer.concat(chunks);
  const payload = assetName.endsWith(".gz") ? zlib.gunzipSync(archive) : archive;
  fs.writeFileSync(targetFile, payload, executableMode === null ? undefined : { mode: executableMode });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\\n");
  process.exit(1);
});
`.trim();
}

function getRustAnalyzerAssetName(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32":
      return "rust-analyzer-x86_64-pc-windows-msvc.exe";
    case "darwin":
      return "rust-analyzer-aarch64-apple-darwin.gz";
    default:
      return "rust-analyzer-x86_64-unknown-linux-gnu.gz";
  }
}
