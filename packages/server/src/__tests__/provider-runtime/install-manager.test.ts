import { codexDefinition } from "@coder-studio/providers";
import { describe, expect, it, vi } from "vitest";
import { ProviderInstallManager } from "../../provider-runtime/install-manager.js";

describe("ProviderInstallManager", () => {
  it("builds a Windows plan that installs Node first when npm is missing", async () => {
    const commandExists = vi.fn(async (command: string) => command === "winget");
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "win32",
      commandExists,
      execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start("codex");

    expect(job.strategyIds).toEqual(["winget-nodejs-lts", "npm-install-codex"]);
    expect(job.steps.map((step) => step.id)).toEqual([
      "install-prerequisite-npm",
      "install-provider-codex",
      "verify-provider-codex",
    ]);
  });

  it("returns a failed job with missing_prerequisite when Linux has no npm", async () => {
    const commandExists = vi.fn(async () => false);
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "linux",
      commandExists,
      execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start("codex");

    expect(job.status).toBe("failed");
    expect(job.failure).toMatchObject({
      code: "missing_prerequisite",
      missingCommands: ["npm"],
    });
    expect(job.steps.map((step) => step.id)).toContain("install-prerequisite-npm");
    expect(job.failure?.failedStepId).toBe("install-prerequisite-npm");
    expect(job.steps.some((step) => step.id === job.failure?.failedStepId)).toBe(true);
  });

  it("returns a failed job with unsupported_platform and a real failed check step", async () => {
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "aix",
      commandExists: vi.fn(async (command: string) => command === "npm"),
      execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start("codex");

    expect(job.status).toBe("failed");
    expect(job.failure).toMatchObject({
      code: "unsupported_platform",
      failedStepId: "install-provider-codex",
    });
    expect(job.steps.map((step) => step.id)).toContain("install-provider-codex");
    expect(job.steps.some((step) => step.id === job.failure?.failedStepId)).toBe(true);
  });

  it("reuses the active job when the same provider is clicked twice", async () => {
    const pending = new Promise<{ stdout: string; stderr: string }>(() => {});
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "npm"),
      execFile: vi.fn(() => pending),
    });

    const first = await manager.start("codex");
    const second = await manager.start("codex");

    expect(second.jobId).toBe(first.jobId);
  });

  it("reuses the same job for concurrent starts while preparation is still in flight", async () => {
    let releaseLookup: (() => void) | undefined;
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const commandExists = vi.fn(async (command: string) => {
      if (command === "codex") {
        await lookupGate;
        return false;
      }

      return command === "npm";
    });
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "linux",
      commandExists,
      execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const firstPromise = manager.start("codex");
    const secondPromise = manager.start("codex");

    releaseLookup?.();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(second.jobId).toBe(first.jobId);
    expect(commandExists).toHaveBeenCalledWith("codex");
  });

  it("classifies install-step ENOENT failures as command_not_found and returns snapshots defensively", async () => {
    const installError = Object.assign(new Error("spawn npm ENOENT"), {
      code: "ENOENT",
      stderr: "npm: command not found",
      stdout: "attempted install output",
    });
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "linux",
      commandExists: vi.fn(async (command: string) => command === "npm"),
      execFile: vi.fn(async () => {
        throw installError;
      }),
    });

    const started = await manager.start("codex");

    started.status = "succeeded";
    started.steps[0]!.status = "succeeded";

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("failed");
    });

    const stored = manager.get(started.jobId);

    expect(stored).toMatchObject({
      status: "failed",
      failure: {
        code: "command_not_found",
        command: "npm",
        stdoutExcerpt: "attempted install output",
        stderrExcerpt: "npm: command not found",
      },
    });
    expect(stored?.steps[0]?.status).toBe("failed");
  });

  it("passes windowsHide to injected execFile on Windows install steps", async () => {
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => ({
        stdout: "",
        stderr: "",
      })
    );
    let codexChecks = 0;
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "win32",
      commandExists: vi.fn(async (command: string) => {
        if (command === "winget") {
          return true;
        }

        if (command === "codex") {
          codexChecks += 1;
          return codexChecks > 1;
        }

        return false;
      }),
      execFile,
    });

    const job = await manager.start("codex");

    await vi.waitFor(() => {
      expect(manager.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFile).toHaveBeenCalledWith(
      "winget",
      ["install", "--id", "OpenJS.NodeJS.LTS", "--exact", "--silent"],
      { windowsHide: true }
    );
    expect(execFile).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@openai/codex"],
      { windowsHide: true }
    );
  });
});
