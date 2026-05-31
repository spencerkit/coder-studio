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
  routeClientId?: string;
}

export interface SystemDependencyInstallManagerDeps extends RuntimeStatusDeps {
  ptyHost: PtyHost;
  broadcaster: Pick<Broadcaster, "sendToClient">;
}

interface InFlightStart {
  ownerId?: string;
  promise: Promise<SystemDependencyInstallJobSnapshot>;
}

interface PtyExitEvent {
  exitCode: number;
  signal?: number;
  reason?: "exit" | "pty_disconnected";
}

export class SystemDependencyInstallManager {
  private readonly jobs = new Map<string, SystemDependencyInstallJobSnapshot>();
  private readonly jobOwnerIds = new Map<string, string>();
  private readonly activeJobIdsByDependencyId = new Map<SystemDependencyId, string>();
  private readonly inFlightStartsByDependencyId = new Map<SystemDependencyId, InFlightStart>();
  private readonly sessions = new Map<string, InstallSession>();

  constructor(private readonly deps: SystemDependencyInstallManagerDeps) {}

  async start(
    dependencyId: SystemDependencyId,
    ownerId?: string,
    routeClientId?: string
  ): Promise<SystemDependencyInstallJobSnapshot> {
    const activeJob = this.getActiveJob(dependencyId);
    if (activeJob) {
      if (!this.canAccessJob(activeJob.jobId, ownerId)) {
        throw {
          code: "system_dependency_install_in_progress",
          message: `Install already in progress for ${dependencyId}`,
        };
      }
      this.rebindSessionRouteClient(activeJob.jobId, routeClientId);
      return cloneJobSnapshot(activeJob);
    }

    const inFlightStart = this.inFlightStartsByDependencyId.get(dependencyId);
    if (inFlightStart) {
      if (!this.matchesOwner(inFlightStart.ownerId, ownerId)) {
        throw {
          code: "system_dependency_install_in_progress",
          message: `Install already in progress for ${dependencyId}`,
        };
      }
      const job = await inFlightStart.promise;
      this.rebindSessionRouteClient(job.jobId, routeClientId);
      return cloneJobSnapshot(job);
    }

    const startPromise = this.prepareAndStart(dependencyId, ownerId, routeClientId);
    this.inFlightStartsByDependencyId.set(dependencyId, {
      ownerId,
      promise: startPromise,
    });

    try {
      return cloneJobSnapshot(await startPromise);
    } finally {
      if (this.inFlightStartsByDependencyId.get(dependencyId)?.promise === startPromise) {
        this.inFlightStartsByDependencyId.delete(dependencyId);
      }
    }
  }

  get(
    jobId: string,
    ownerId?: string,
    routeClientId?: string
  ): SystemDependencyInstallJobSnapshot | undefined {
    if (!this.canAccessJob(jobId, ownerId)) {
      return undefined;
    }

    this.rebindSessionRouteClient(jobId, routeClientId);
    const job = this.jobs.get(jobId);
    return job ? cloneJobSnapshot(job) : undefined;
  }

  async submitInput(
    jobId: string,
    ownerId: string | undefined,
    text: string,
    routeClientId?: string
  ): Promise<SystemDependencyInstallJobSnapshot> {
    const job = this.getOwnedJob(jobId, ownerId);
    const session = this.sessions.get(jobId);
    if (!job || !session) {
      throw {
        code: "system_dependency_install_job_not_found",
        message: `Install job not found: ${jobId}`,
      };
    }

    this.rebindSessionRouteClient(jobId, routeClientId);
    job.status = "running";
    job.interaction = { kind: "none", echo: false };
    session.process.write(text);

    return cloneJobSnapshot(job);
  }

  async cancel(
    jobId: string,
    ownerId?: string,
    routeClientId?: string
  ): Promise<SystemDependencyInstallJobSnapshot> {
    const job = this.getOwnedJob(jobId, ownerId);
    if (!job) {
      throw {
        code: "system_dependency_install_job_not_found",
        message: `Install job not found: ${jobId}`,
      };
    }

    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return cloneJobSnapshot(job);
    }

    this.rebindSessionRouteClient(jobId, routeClientId);
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
    dependencyId: SystemDependencyId,
    ownerId?: string,
    routeClientId?: string
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
      this.storeJob(readyJob, ownerId);
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
      this.storeJob(failedJob, ownerId);
      return failedJob;
    }

    return this.spawnInstallJob(dependencyId, entry.packageManager, ownerId, routeClientId);
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
    packageManager: SystemDependencyPackageManager,
    ownerId?: string,
    routeClientId?: string
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

      this.storeJob(job, ownerId);
      this.activeJobIdsByDependencyId.set(dependencyId, job.jobId);
      this.sessions.set(job.jobId, { process: ptyProcess, seq: 0, routeClientId });

      ptyProcess.onData((chunk) => {
        this.handleOutput(job.jobId, chunk);
      });
      ptyProcess.onExit((event) => {
        void this.handleExit(job.jobId, event as PtyExitEvent);
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
          code: classifySpawnFailure(details),
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
      this.storeJob(failedJob, ownerId);
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
    if (session.routeClientId) {
      this.deps.broadcaster.sendToClient(session.routeClientId, {
        kind: "event",
        topic: Topics.systemDependencyInstallOutput(jobId),
        seq: session.seq,
        timestamp: Date.now(),
        data: {
          jobId,
          chunk,
          seq: session.seq,
        },
      });
    }

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

  private async handleExit(jobId: string, event: PtyExitEvent): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    const exitCode = event.exitCode;

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
        code: this.classifyFailureCode(job, event),
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
    const latestJob = this.jobs.get(jobId);

    if (!latestJob || latestJob.status === "cancelled") {
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

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

  private storeJob(
    job: SystemDependencyInstallJobSnapshot,
    ownerId?: string
  ): SystemDependencyInstallJobSnapshot {
    this.jobs.set(job.jobId, job);
    if (ownerId) {
      this.jobOwnerIds.set(job.jobId, ownerId);
    }
    return job;
  }

  private getOwnedJob(
    jobId: string,
    ownerId?: string
  ): SystemDependencyInstallJobSnapshot | undefined {
    if (!this.canAccessJob(jobId, ownerId)) {
      return undefined;
    }

    return this.jobs.get(jobId);
  }

  private canAccessJob(jobId: string, ownerId?: string): boolean {
    const owner = this.jobOwnerIds.get(jobId);
    if (!owner) {
      return true;
    }

    return owner === ownerId;
  }

  private matchesOwner(ownerA?: string, ownerB?: string): boolean {
    if (!ownerA && !ownerB) {
      return true;
    }

    return ownerA === ownerB;
  }

  private rebindSessionRouteClient(jobId: string, routeClientId?: string): void {
    if (!routeClientId) {
      return;
    }

    const session = this.sessions.get(jobId);
    if (session) {
      session.routeClientId = routeClientId;
    }
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

  private classifyFailureCode(
    job: SystemDependencyInstallJobSnapshot,
    event: PtyExitEvent
  ): SystemDependencyInstallFailure["code"] {
    if (event.reason === "pty_disconnected") {
      return "pty_disconnected";
    }

    const step = this.getCurrentStep(job);
    const haystack = `${step?.stdoutExcerpt ?? ""}\n${step?.stderrExcerpt ?? ""}`.toLowerCase();

    if (
      haystack.includes("permission denied") ||
      haystack.includes("eacces") ||
      haystack.includes("eperm") ||
      haystack.includes("incorrect password")
    ) {
      return "permission_denied";
    }

    if (
      haystack.includes("not found") ||
      haystack.includes("is not recognized") ||
      haystack.includes("enoent")
    ) {
      return "command_not_found";
    }

    return "command_failed";
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

function classifySpawnFailure(details: {
  code?: string;
  message: string;
  stdout?: string;
  stderr?: string;
}): SystemDependencyInstallFailure["code"] {
  const haystack = `${details.code ?? ""}\n${details.message}\n${details.stderr ?? ""}\n${
    details.stdout ?? ""
  }`.toLowerCase();

  if (
    haystack.includes("permission denied") ||
    haystack.includes("eacces") ||
    haystack.includes("eperm")
  ) {
    return "permission_denied";
  }

  if (
    haystack.includes("not found") ||
    haystack.includes("is not recognized") ||
    haystack.includes("enoent")
  ) {
    return "command_not_found";
  }

  return "command_failed";
}
