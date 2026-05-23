import { randomUUID } from "node:crypto";
import process from "node:process";
import type {
  SystemDependencyId,
  SystemDependencyInstallFailure,
  SystemDependencyInstallJobSnapshot,
  SystemDependencyInstallStepSnapshot,
  SystemDependencyPackageManager,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import type { PtyHost, PtyProcess } from "../terminal/types.js";
import type { Broadcaster } from "../ws/hub.js";
import { SYSTEM_DEPENDENCY_DEFINITIONS } from "./definitions.js";
import { detectSystemDependencyInteraction } from "./interaction-detector.js";
import { buildSystemDependencyRuntimeStatus } from "./runtime-status.js";

const EXCERPT_LIMIT = 400;

interface InstallSession {
  process: PtyProcess;
  seq: number;
}

export interface SystemDependencyInstallManagerDeps extends RuntimeStatusDeps {
  ptyHost: PtyHost;
  broadcaster: Pick<Broadcaster, "broadcast">;
}

export class SystemDependencyInstallManager {
  private readonly jobs = new Map<string, SystemDependencyInstallJobSnapshot>();
  private readonly activeJobIdsByDependencyId = new Map<SystemDependencyId, string>();
  private readonly inFlightStartsByDependencyId = new Map<
    SystemDependencyId,
    Promise<SystemDependencyInstallJobSnapshot>
  >();
  private readonly sessions = new Map<string, InstallSession>();

  constructor(private readonly deps: SystemDependencyInstallManagerDeps) {}

  async start(dependencyId: SystemDependencyId): Promise<SystemDependencyInstallJobSnapshot> {
    const activeJob = this.getActiveJob(dependencyId);
    if (activeJob) {
      return cloneJobSnapshot(activeJob);
    }

    const inFlightStart = this.inFlightStartsByDependencyId.get(dependencyId);
    if (inFlightStart) {
      return cloneJobSnapshot(await inFlightStart);
    }

    const startPromise = this.prepareAndStart(dependencyId);
    this.inFlightStartsByDependencyId.set(dependencyId, startPromise);

    try {
      return cloneJobSnapshot(await startPromise);
    } finally {
      if (this.inFlightStartsByDependencyId.get(dependencyId) === startPromise) {
        this.inFlightStartsByDependencyId.delete(dependencyId);
      }
    }
  }

  get(jobId: string): SystemDependencyInstallJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    return job ? cloneJobSnapshot(job) : undefined;
  }

  async submitInput(jobId: string, text: string): Promise<SystemDependencyInstallJobSnapshot> {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) {
      throw {
        code: "system_dependency_install_job_not_found",
        message: `Install job not found: ${jobId}`,
      };
    }

    job.status = "running";
    job.interaction = { kind: "none", echo: false };
    session.process.write(text);

    return cloneJobSnapshot(job);
  }

  async cancel(jobId: string): Promise<SystemDependencyInstallJobSnapshot> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw {
        code: "system_dependency_install_job_not_found",
        message: `Install job not found: ${jobId}`,
      };
    }

    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return cloneJobSnapshot(job);
    }

    const session = this.sessions.get(jobId);
    const installStep = this.getCurrentStep(job);
    if (installStep) {
      installStep.status = "failed";
      installStep.finishedAt = Date.now();
      installStep.exitCode = 130;
    }

    job.status = "cancelled";
    job.interaction = { kind: "none", echo: false };
    job.failure = this.createFailure(job, {
      code: "user_cancelled",
      message: `Install cancelled for ${job.dependencyId}`,
      exitCode: 130,
    });

    this.activeJobIdsByDependencyId.delete(job.dependencyId);

    if (session) {
      await session.process.kill("SIGTERM");
      this.sessions.delete(jobId);
    }

    return cloneJobSnapshot(job);
  }

  private getActiveJob(
    dependencyId: SystemDependencyId
  ): SystemDependencyInstallJobSnapshot | undefined {
    const jobId = this.activeJobIdsByDependencyId.get(dependencyId);
    if (!jobId) {
      return undefined;
    }

    const job = this.jobs.get(jobId);
    if (!job) {
      this.activeJobIdsByDependencyId.delete(dependencyId);
      return undefined;
    }

    if (job.status === "running" || job.status === "waiting_input" || job.status === "queued") {
      return job;
    }

    this.activeJobIdsByDependencyId.delete(dependencyId);
    return undefined;
  }

  private async prepareAndStart(
    dependencyId: SystemDependencyId
  ): Promise<SystemDependencyInstallJobSnapshot> {
    const runtime = await buildSystemDependencyRuntimeStatus(this.deps);
    const entry = runtime.dependencies[dependencyId];

    if (entry.available) {
      const readyJob: SystemDependencyInstallJobSnapshot = {
        jobId: randomUUID(),
        dependencyId,
        status: "succeeded",
        packageManager: entry.packageManager,
        steps: [],
        interaction: { kind: "none", echo: false },
      };
      this.jobs.set(readyJob.jobId, readyJob);
      return readyJob;
    }

    if (!entry.autoInstallSupported || !entry.packageManager) {
      const failedJob = this.createUnsupportedJob(
        dependencyId,
        entry.installReadiness === "unsupported_platform"
          ? "unsupported_platform"
          : "unsupported_package_manager",
        entry.packageManager
      );
      this.jobs.set(failedJob.jobId, failedJob);
      return failedJob;
    }

    return this.spawnInstallJob(dependencyId, entry.packageManager);
  }

  private createUnsupportedJob(
    dependencyId: SystemDependencyId,
    code: "unsupported_platform" | "unsupported_package_manager",
    packageManager: SystemDependencyPackageManager | undefined
  ): SystemDependencyInstallJobSnapshot {
    const stepId = `install-${dependencyId}`;
    const command = packageManager ?? dependencyId;

    return {
      jobId: randomUUID(),
      dependencyId,
      status: "failed",
      packageManager,
      currentStepId: stepId,
      steps: [
        {
          id: stepId,
          titleKey: `system_deps.install.step.install.${dependencyId}`,
          kind: "install",
          command,
          args: [],
          status: "failed",
          finishedAt: Date.now(),
        },
      ],
      interaction: { kind: "none", echo: false },
      failure: {
        code,
        dependencyId,
        failedStepId: stepId,
        message: `Cannot auto-install ${dependencyId}`,
        command,
        args: [],
        packageManager,
        manualGuideKeys: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].manualGuideKeys,
        docUrl: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].docsUrl,
      },
    };
  }

  private spawnInstallJob(
    dependencyId: SystemDependencyId,
    packageManager: SystemDependencyPackageManager
  ): SystemDependencyInstallJobSnapshot {
    const shellCommand = getInstallShellCommand(packageManager, dependencyId);
    const env = getPtyEnv();
    const stepId = `install-${dependencyId}`;

    try {
      const ptyProcess = this.deps.ptyHost.spawn(["/bin/sh", "-lc", shellCommand], {
        cwd: process.cwd(),
        env,
        cols: 120,
        rows: 30,
      });

      const job: SystemDependencyInstallJobSnapshot = {
        jobId: randomUUID(),
        dependencyId,
        status: "running",
        packageManager,
        currentStepId: stepId,
        steps: [
          {
            id: stepId,
            titleKey: `system_deps.install.step.install.${dependencyId}`,
            kind: "install",
            command: "/bin/sh",
            args: ["-lc", shellCommand],
            status: "running",
            startedAt: Date.now(),
          },
          {
            id: `verify-${dependencyId}`,
            titleKey: `system_deps.install.step.verify.${dependencyId}`,
            kind: "verify",
            command: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].versionCommand.file,
            args: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].versionCommand.args,
            status: "pending",
          },
        ],
        interaction: { kind: "none", echo: false },
      };

      this.jobs.set(job.jobId, job);
      this.activeJobIdsByDependencyId.set(dependencyId, job.jobId);
      this.sessions.set(job.jobId, { process: ptyProcess, seq: 0 });

      ptyProcess.onData((chunk) => {
        this.handleOutput(job.jobId, chunk);
      });
      ptyProcess.onExit(({ exitCode }) => {
        void this.handleExit(job.jobId, exitCode);
      });

      return job;
    } catch (error) {
      const details = toErrorDetails(error);
      const failedJob: SystemDependencyInstallJobSnapshot = {
        jobId: randomUUID(),
        dependencyId,
        status: "failed",
        packageManager,
        currentStepId: stepId,
        steps: [
          {
            id: stepId,
            titleKey: `system_deps.install.step.install.${dependencyId}`,
            kind: "install",
            command: "/bin/sh",
            args: ["-lc", shellCommand],
            status: "failed",
            finishedAt: Date.now(),
            stdoutExcerpt: excerpt(details.stdout),
            stderrExcerpt: excerpt(details.stderr || details.message),
          },
        ],
        interaction: { kind: "none", echo: false },
        failure: {
          code: details.code === "ENOENT" ? "command_not_found" : "unknown_failure",
          dependencyId,
          failedStepId: stepId,
          message: details.message,
          command: "/bin/sh",
          args: ["-lc", shellCommand],
          packageManager,
          manualGuideKeys: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].manualGuideKeys,
          docUrl: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].docsUrl,
          stdoutExcerpt: excerpt(details.stdout),
          stderrExcerpt: excerpt(details.stderr || details.message),
        },
      };
      this.jobs.set(failedJob.jobId, failedJob);
      return failedJob;
    }
  }

  private handleOutput(jobId: string, chunk: string): void {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) {
      return;
    }

    session.seq += 1;
    this.deps.broadcaster.broadcast(Topics.systemDependencyInstallOutput(jobId), {
      jobId,
      chunk,
      seq: session.seq,
    });

    const interaction = detectSystemDependencyInteraction(chunk);
    if (interaction.kind !== "none") {
      job.status = "waiting_input";
      job.interaction = interaction;
    }

    const installStep = job.steps[0];
    if (installStep) {
      installStep.stdoutExcerpt = excerpt(chunk);
    }
  }

  private async handleExit(jobId: string, exitCode: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    const installStep = job.steps[0];
    if (installStep && installStep.finishedAt === undefined) {
      installStep.finishedAt = Date.now();
      installStep.exitCode = exitCode;
      if (job.status !== "cancelled") {
        installStep.status = exitCode === 0 ? "succeeded" : "failed";
      }
    }

    this.sessions.delete(jobId);

    if (job.status === "cancelled") {
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

    if (exitCode !== 0) {
      job.status = "failed";
      job.interaction = { kind: "none", echo: false };
      job.failure = this.createFailure(job, {
        code: "command_failed",
        message: `Install failed for ${job.dependencyId}`,
        exitCode,
      });
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

    const verifyStep = job.steps[1];
    if (verifyStep) {
      job.currentStepId = verifyStep.id;
      verifyStep.status = "running";
      verifyStep.startedAt = Date.now();
    }

    const runtime = await buildSystemDependencyRuntimeStatus(this.deps);
    const entry = runtime.dependencies[job.dependencyId];

    if (verifyStep) {
      verifyStep.finishedAt = Date.now();
      verifyStep.stdoutExcerpt = entry.version;
      verifyStep.status = entry.available ? "succeeded" : "failed";
    }

    if (!entry.available) {
      job.status = "failed";
      job.interaction = { kind: "none", echo: false };
      job.failure = this.createFailure(job, {
        code: "verification_failed",
        message: `Verification failed for ${job.dependencyId}`,
      });
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

    job.status = "succeeded";
    job.interaction = { kind: "none", echo: false };
    this.activeJobIdsByDependencyId.delete(job.dependencyId);
  }

  private getCurrentStep(
    job: SystemDependencyInstallJobSnapshot
  ): SystemDependencyInstallStepSnapshot | undefined {
    if (job.currentStepId) {
      return job.steps.find((step) => step.id === job.currentStepId);
    }

    return job.steps.at(-1);
  }

  private createFailure(
    job: SystemDependencyInstallJobSnapshot,
    input: {
      code: SystemDependencyInstallFailure["code"];
      message: string;
      exitCode?: number;
    }
  ): SystemDependencyInstallFailure {
    const step = this.getCurrentStep(job);
    return {
      code: input.code,
      dependencyId: job.dependencyId,
      failedStepId: step?.id ?? `install-${job.dependencyId}`,
      message: input.message,
      command: step?.command ?? job.dependencyId,
      args: step?.args ?? [],
      exitCode: input.exitCode,
      packageManager: job.packageManager,
      manualGuideKeys: SYSTEM_DEPENDENCY_DEFINITIONS[job.dependencyId].manualGuideKeys,
      docUrl: SYSTEM_DEPENDENCY_DEFINITIONS[job.dependencyId].docsUrl,
      stdoutExcerpt: step?.stdoutExcerpt,
      stderrExcerpt: step?.stderrExcerpt,
    };
  }
}

function getInstallShellCommand(
  packageManager: SystemDependencyPackageManager,
  dependencyId: SystemDependencyId
): string {
  const packageName = dependencyId === "git" ? "git" : "node";

  switch (packageManager) {
    case "brew":
      return `brew install ${packageName}`;
    case "apt-get":
      return dependencyId === "git"
        ? "sudo apt-get update && sudo apt-get install -y git"
        : "sudo apt-get update && sudo apt-get install -y nodejs npm";
    case "dnf":
      return `sudo dnf install -y ${dependencyId === "git" ? "git" : "nodejs"}`;
    case "yum":
      return `sudo yum install -y ${dependencyId === "git" ? "git" : "nodejs"}`;
    case "pacman":
      return dependencyId === "git"
        ? "sudo pacman -Sy --noconfirm git"
        : "sudo pacman -Sy --noconfirm nodejs npm";
    case "zypper":
      return `sudo zypper --non-interactive install ${dependencyId === "git" ? "git" : "nodejs"}`;
  }
}

function getPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value != null) {
      env[key] = value;
    }
  }

  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.FORCE_COLOR = "3";

  return env;
}

function excerpt(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length <= EXCERPT_LIMIT ? value : value.slice(-EXCERPT_LIMIT);
}

function cloneJobSnapshot(
  job: SystemDependencyInstallJobSnapshot
): SystemDependencyInstallJobSnapshot {
  return structuredClone(job);
}

function toErrorDetails(error: unknown): {
  code?: string;
  message: string;
  stdout?: string;
  stderr?: string;
} {
  const candidate = error as {
    code?: string;
    message?: string;
    stdout?: string;
    stderr?: string;
  };

  return {
    code: candidate.code,
    message: candidate.message ?? "Unknown system dependency install error",
    stdout: candidate.stdout,
    stderr: candidate.stderr,
  };
}
