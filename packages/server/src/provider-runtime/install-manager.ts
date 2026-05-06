import { execFile as nodeExecFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type {
  ProviderDefinition,
  ProviderInstallFailure,
  ProviderInstallJobSnapshot,
  ProviderInstallStepSnapshot,
} from "@coder-studio/core";
import {
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
  checkCommandAvailable,
} from "./command-check.js";

const execFileAsync = promisify(nodeExecFile);
const EXCERPT_LIMIT = 400;
type ExecFileOptions = { windowsHide?: boolean };

export interface InstallManagerDeps extends CommandCheckDeps {
  commandExists?: CommandAvailabilityCheck;
  execFile?: (
    file: string,
    args: string[],
    options?: ExecFileOptions
  ) => Promise<{ stdout: string; stderr: string }>;
}

export class ProviderInstallManager {
  private readonly providers = new Map<string, ProviderDefinition>();
  private readonly jobs = new Map<string, ProviderInstallJobSnapshot>();
  private readonly activeJobIdsByProviderId = new Map<string, string>();
  private readonly inFlightStartsByProviderId = new Map<
    string,
    Promise<ProviderInstallJobSnapshot>
  >();
  private readonly deps: InstallManagerDeps;

  constructor(providers: ProviderDefinition[], deps: InstallManagerDeps = {}) {
    this.deps = deps;
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  async start(providerId: string): Promise<ProviderInstallJobSnapshot> {
    const activeJob = this.getActiveJob(providerId);
    if (activeJob) {
      return cloneJobSnapshot(activeJob);
    }

    const inFlightStart = this.inFlightStartsByProviderId.get(providerId);
    if (inFlightStart) {
      return cloneJobSnapshot(await inFlightStart);
    }

    const startPromise = this.prepareAndStart(providerId);
    this.inFlightStartsByProviderId.set(providerId, startPromise);

    try {
      return cloneJobSnapshot(await startPromise);
    } finally {
      if (this.inFlightStartsByProviderId.get(providerId) === startPromise) {
        this.inFlightStartsByProviderId.delete(providerId);
      }
    }
  }

  get(jobId: string): ProviderInstallJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    return job ? cloneJobSnapshot(job) : undefined;
  }

  private async prepareAndStart(providerId: string): Promise<ProviderInstallJobSnapshot> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw { code: "unknown_provider", message: `Provider not found: ${providerId}` };
    }

    const job = await this.prepare(provider);
    this.jobs.set(job.jobId, job);

    if (job.status === "queued") {
      this.activeJobIdsByProviderId.set(provider.id, job.jobId);
      void this.runPreparedJob(provider, job);
    }

    return job;
  }

  private async prepare(provider: ProviderDefinition): Promise<ProviderInstallJobSnapshot> {
    const platform = this.deps.platform ?? process.platform;
    const strategies = provider.install.strategies[platform] ?? [];
    const availableCommands = new Set<string>();

    const missingProviderCommands = await this.collectMissing(
      provider.requiredCommands,
      availableCommands
    );
    if (missingProviderCommands.length === 0) {
      return {
        jobId: randomUUID(),
        providerId: provider.id,
        strategyIds: [],
        status: "succeeded",
        steps: [],
      };
    }

    const missingPrerequisites = await this.collectMissing(
      provider.install.prerequisites,
      availableCommands
    );

    const dependencyCommands = new Set<string>();
    for (const strategy of strategies) {
      for (const command of strategy.requiresCommands) {
        dependencyCommands.add(command);
      }
    }

    for (const command of dependencyCommands) {
      if (availableCommands.has(command)) {
        continue;
      }
      if (await this.commandExists(command)) {
        availableCommands.add(command);
      }
    }

    const remainingProviderCommands = new Set(missingProviderCommands);
    const remainingPrerequisites = new Set(missingPrerequisites);
    const reachableCommands = new Set(availableCommands);
    const selectedStrategyIds = new Set<string>();
    const selectedSteps: ProviderInstallStepSnapshot[] = [];
    let progressed = true;

    while (progressed) {
      progressed = false;

      for (const strategy of strategies) {
        if (selectedStrategyIds.has(strategy.id)) {
          continue;
        }

        const requiresMet = strategy.requiresCommands.every((command) =>
          reachableCommands.has(command)
        );
        if (!requiresMet) {
          continue;
        }

        if (
          strategy.kind === "prerequisite" &&
          remainingPrerequisites.has(strategy.targetCommand)
        ) {
          selectedStrategyIds.add(strategy.id);
          selectedSteps.push(
            this.createInstallStep(strategy.kind, strategy.targetCommand, strategy)
          );
          remainingPrerequisites.delete(strategy.targetCommand);
          reachableCommands.add(strategy.targetCommand);
          progressed = true;
          continue;
        }

        if (strategy.kind === "provider" && remainingProviderCommands.has(strategy.targetCommand)) {
          selectedStrategyIds.add(strategy.id);
          selectedSteps.push(
            this.createInstallStep(strategy.kind, strategy.targetCommand, strategy)
          );
          remainingProviderCommands.delete(strategy.targetCommand);
          reachableCommands.add(strategy.targetCommand);
          progressed = true;
        }
      }
    }

    const jobId = randomUUID();
    if (remainingPrerequisites.size > 0) {
      const failedStep = this.createCheckStep(
        "prerequisite",
        [...remainingPrerequisites][0] ?? "",
        "provider.install.step.prerequisite.missing"
      );
      return {
        jobId,
        providerId: provider.id,
        strategyIds: [...selectedStrategyIds],
        status: "failed",
        steps: [...selectedSteps, failedStep],
        failure: this.createFailure(
          provider,
          failedStep,
          "missing_prerequisite",
          `Missing prerequisite commands: ${[...remainingPrerequisites].join(", ")}`,
          [...remainingPrerequisites]
        ),
      };
    }

    if (remainingProviderCommands.size > 0) {
      const failedStep = this.createCheckStep(
        "provider",
        [...remainingProviderCommands][0] ?? "",
        "provider.install.step.provider.unsupported"
      );
      return {
        jobId,
        providerId: provider.id,
        strategyIds: [...selectedStrategyIds],
        status: "failed",
        steps: [...selectedSteps, failedStep],
        failure: this.createFailure(
          provider,
          failedStep,
          "unsupported_platform",
          `No supported install strategy for commands: ${[...remainingProviderCommands].join(", ")}`,
          [...remainingProviderCommands]
        ),
      };
    }

    selectedSteps.push({
      id: `verify-provider-${provider.id}`,
      titleKey: `provider.install.step.verify.${provider.id}`,
      kind: "verify",
      command: provider.requiredCommands[0] ?? provider.id,
      args: ["--version"],
      status: "pending",
    });

    return {
      jobId,
      providerId: provider.id,
      strategyIds: [...selectedStrategyIds],
      status: "queued",
      currentStepId: selectedSteps[0]?.id,
      steps: selectedSteps,
    };
  }

  private async runPreparedJob(
    provider: ProviderDefinition,
    job: ProviderInstallJobSnapshot
  ): Promise<void> {
    const execFile =
      this.deps.execFile ??
      ((file: string, args: string[], options?: ExecFileOptions) =>
        execFileAsync(file, args, options));

    job.status = "running";
    this.jobs.set(job.jobId, job);

    for (const step of job.steps) {
      job.currentStepId = step.id;
      step.status = "running";
      step.startedAt = Date.now();
      this.jobs.set(job.jobId, job);

      try {
        if (step.kind === "verify") {
          const available = await this.commandExists(step.command);
          if (!available) {
            step.status = "failed";
            step.finishedAt = Date.now();
            job.status = "failed";
            job.failure = this.createFailure(
              provider,
              step,
              "verification_failed",
              `Verification failed for command: ${step.command}`,
              [step.command]
            );
            this.clearActiveJob(provider.id, job.jobId);
            this.jobs.set(job.jobId, job);
            return;
          }
        } else {
          const result = await execFile(step.command, step.args, { windowsHide: true });
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
        job.failure = this.normalizeFailure(provider, step, error);
        this.clearActiveJob(provider.id, job.jobId);
        this.jobs.set(job.jobId, job);
        return;
      }
    }

    job.status = "succeeded";
    job.currentStepId = undefined;
    this.clearActiveJob(provider.id, job.jobId);
    this.jobs.set(job.jobId, job);
  }

  private async collectMissing(
    commands: string[],
    availableCommands?: Set<string>
  ): Promise<string[]> {
    const missing: string[] = [];

    for (const command of commands) {
      if (await this.commandExists(command)) {
        availableCommands?.add(command);
      } else {
        missing.push(command);
      }
    }

    return missing;
  }

  private async commandExists(command: string): Promise<boolean> {
    const commandExists =
      this.deps.commandExists ??
      ((candidate: string) => checkCommandAvailable(candidate, this.deps));
    return commandExists(command);
  }

  private normalizeFailure(
    provider: ProviderDefinition,
    step: ProviderInstallStepSnapshot,
    error: unknown
  ): ProviderInstallFailure {
    const details = getErrorDetails(error);
    const haystack = `${details.message}\n${details.stderr}\n${details.stdout}`.toLowerCase();

    let code: ProviderInstallFailure["code"] = "command_failed";
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
    }

    return this.createFailure(
      provider,
      {
        ...step,
        exitCode: details.exitCode,
        stdoutExcerpt: excerpt(details.stdout),
        stderrExcerpt: excerpt(details.stderr || details.message),
      },
      code,
      details.message || `Install step failed: ${step.command}`,
      []
    );
  }

  private createFailure(
    provider: ProviderDefinition,
    step: ProviderInstallStepSnapshot,
    code: ProviderInstallFailure["code"],
    message: string,
    missingCommands: string[]
  ): ProviderInstallFailure {
    return {
      code,
      providerId: provider.id,
      failedStepId: step.id,
      message,
      command: step.command,
      args: step.args,
      exitCode: step.exitCode,
      stdoutExcerpt: step.stdoutExcerpt,
      stderrExcerpt: step.stderrExcerpt,
      missingCommands,
      manualGuideKeys: provider.install.manualGuideKeys,
      docUrls: provider.install.docUrls,
    };
  }

  private createInstallStep(
    kind: "prerequisite" | "provider",
    targetCommand: string,
    strategy: {
      command: string;
      args: string[];
    }
  ): ProviderInstallStepSnapshot {
    return {
      id: `install-${kind}-${targetCommand}`,
      titleKey: `provider.install.step.${kind}.${targetCommand}`,
      kind: "install",
      command: strategy.command,
      args: strategy.args,
      status: "pending",
    };
  }

  private createCheckStep(
    kind: "prerequisite" | "provider",
    targetCommand: string,
    titleKey: string
  ): ProviderInstallStepSnapshot {
    return {
      id: `install-${kind}-${targetCommand}`,
      titleKey,
      kind: "check",
      command: targetCommand,
      args: [],
      status: "failed",
    };
  }

  private clearActiveJob(providerId: string, jobId: string): void {
    if (this.activeJobIdsByProviderId.get(providerId) === jobId) {
      this.activeJobIdsByProviderId.delete(providerId);
    }
  }

  private getActiveJob(providerId: string): ProviderInstallJobSnapshot | undefined {
    const activeJobId = this.activeJobIdsByProviderId.get(providerId);
    if (!activeJobId) {
      return undefined;
    }

    const activeJob = this.jobs.get(activeJobId);
    if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
      return activeJob;
    }

    this.activeJobIdsByProviderId.delete(providerId);
    return undefined;
  }
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

  if (typeof error === "string") {
    return {
      message: error,
      stdout: "",
      stderr: "",
    };
  }

  return {
    message: "Unknown install failure",
    stdout: "",
    stderr: "",
  };
}

function excerpt(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.slice(0, EXCERPT_LIMIT);
}

function cloneJobSnapshot(job: ProviderInstallJobSnapshot): ProviderInstallJobSnapshot {
  return {
    jobId: job.jobId,
    providerId: job.providerId,
    strategyIds: [...job.strategyIds],
    status: job.status,
    currentStepId: job.currentStepId,
    steps: job.steps.map(cloneStepSnapshot),
    failure: job.failure ? cloneFailure(job.failure) : undefined,
  };
}

function cloneStepSnapshot(step: ProviderInstallStepSnapshot): ProviderInstallStepSnapshot {
  return {
    id: step.id,
    titleKey: step.titleKey,
    kind: step.kind,
    command: step.command,
    args: [...step.args],
    status: step.status,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    exitCode: step.exitCode,
    stdoutExcerpt: step.stdoutExcerpt,
    stderrExcerpt: step.stderrExcerpt,
  };
}

function cloneFailure(failure: ProviderInstallFailure): ProviderInstallFailure {
  return {
    code: failure.code,
    providerId: failure.providerId,
    failedStepId: failure.failedStepId,
    message: failure.message,
    command: failure.command,
    args: [...failure.args],
    exitCode: failure.exitCode,
    stdoutExcerpt: failure.stdoutExcerpt,
    stderrExcerpt: failure.stderrExcerpt,
    missingCommands: [...failure.missingCommands],
    manualGuideKeys: [...failure.manualGuideKeys],
    docUrls: {
      provider: failure.docUrls.provider,
      prerequisites: { ...failure.docUrls.prerequisites },
    },
  };
}
