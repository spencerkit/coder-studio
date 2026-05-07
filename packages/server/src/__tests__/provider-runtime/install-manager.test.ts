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
    const execFile = vi.fn((file: string) => {
      if (file === "which") {
        return Promise.resolve({ stdout: "", stderr: "" });
      }

      return pending;
    });
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "npm"),
      execFile,
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

  it("re-resolves and executes the installed npm executable on Windows install steps", async () => {
    let npmInstalled = false;
    let codexInstalled = false;
    const execFile = vi.fn(
      async (file: string, args: string[], _options?: { windowsHide: boolean }) => {
        if (file === "where" && args[0] === "winget") {
          return {
            stdout: "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\r\n",
            stderr: "",
          };
        }

        if (file === "where" && args[0] === "npm") {
          if (!npmInstalled) {
            throw new Error("npm unavailable");
          }

          return {
            stdout: "C:\\npm\\npm.cmd\r\n",
            stderr: "",
          };
        }

        if (file === "where" && args[0] === "codex") {
          if (!codexInstalled) {
            throw new Error("codex unavailable");
          }

          return {
            stdout: "C:\\codex\\codex.exe\r\n",
            stderr: "",
          };
        }

        if (
          file === "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe" &&
          args.join(" ") === "install --id OpenJS.NodeJS.LTS --exact --silent"
        ) {
          npmInstalled = true;
          return { stdout: "installed node", stderr: "" };
        }

        if (file === "C:\\npm\\npm.cmd" && args.join(" ") === "install -g @openai/codex") {
          codexInstalled = true;
          return { stdout: "installed codex", stderr: "" };
        }

        throw new Error(`unexpected execFile call: ${file} ${args.join(" ")}`);
      }
    );
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "win32",
      execFile,
    });

    const job = await manager.start("codex");

    await vi.waitFor(() => {
      expect(manager.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFile).toHaveBeenCalledWith(
      "C:\\npm\\npm.cmd",
      ["install", "-g", "@openai/codex"],
      { windowsHide: true }
    );
  });
});
