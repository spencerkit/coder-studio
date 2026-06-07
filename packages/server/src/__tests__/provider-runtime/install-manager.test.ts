import { codexDefinition, providerRegistry } from "@coder-studio/providers";
import { describe, expect, it, vi } from "vitest";
import { ProviderInstallManager } from "../../provider-runtime/install-manager.js";

describe("ProviderInstallManager", () => {
  it("builds a Windows plan that installs Node first when npm is missing", async () => {
    const commandExists = vi.fn(async (command: string) => command === "winget");
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "win32",
      commandExists,
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
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
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
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
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
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
      runCommand: execFile,
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
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
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
      runCommand: vi.fn(async () => {
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

  it("classifies install-step EACCES failures as permission_denied", async () => {
    const installError = Object.assign(new Error("spawn npm EACCES"), {
      code: "EACCES",
      stderr: "Permission denied",
      stdout: "",
    });
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "linux",
      commandExists: vi.fn(async (command: string) => command === "npm"),
      runCommand: vi.fn(async () => {
        throw installError;
      }),
    });

    const started = await manager.start("codex");

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("failed");
    });

    expect(manager.get(started.jobId)).toMatchObject({
      status: "failed",
      failure: {
        code: "permission_denied",
      },
    });
  });

  it("classifies install-step non-ENOENT non-permission failures as command_failed", async () => {
    const installError = Object.assign(new Error("spawn npm EIO"), {
      code: "EIO",
      stderr: "terminal backend failed",
      stdout: "",
    });
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "linux",
      commandExists: vi.fn(async (command: string) => command === "npm"),
      runCommand: vi.fn(async () => {
        throw installError;
      }),
    });

    const started = await manager.start("codex");

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("failed");
    });

    expect(manager.get(started.jobId)).toMatchObject({
      status: "failed",
      failure: {
        code: "command_failed",
      },
    });
  });

  it("executes Windows install steps with the declared command names", async () => {
    let npmInstalled = false;
    let codexInstalled = false;
    const commandExists = vi.fn(async (command: string) => {
      if (command === "winget") {
        return true;
      }
      if (command === "npm") {
        return npmInstalled;
      }
      if (command === "codex") {
        return codexInstalled;
      }
      return false;
    });
    const execFile = vi.fn(
      async (file: string, args: string[], _options?: { windowsHide: boolean }) => {
        if (
          file === "winget" &&
          args.join(" ") === "install --id OpenJS.NodeJS.LTS --exact --silent"
        ) {
          npmInstalled = true;
          return { stdout: "installed node", stderr: "" };
        }

        if (file === "npm" && args.join(" ") === "install -g @openai/codex") {
          expect(npmInstalled).toBe(true);
          codexInstalled = true;
          return { stdout: "installed codex", stderr: "" };
        }

        throw new Error(`unexpected execFile call: ${file} ${args.join(" ")}`);
      }
    );
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: "win32",
      commandExists,
      runCommand: execFile,
    });

    const job = await manager.start("codex");

    await vi.waitFor(() => {
      expect(manager.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFile).toHaveBeenCalledWith("npm", ["install", "-g", "@openai/codex"], {
      windowsHide: true,
    });
  });

  it("executes Gemini's npm install strategy on Linux", async () => {
    let geminiInstalled = false;
    const commandExists = vi.fn(async (command: string) => {
      if (command === "npm") {
        return true;
      }
      if (command === "gemini") {
        return geminiInstalled;
      }
      return false;
    });
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === "npm" && args.join(" ") === "install -g @google/gemini-cli") {
        geminiInstalled = true;
        return { stdout: "installed gemini", stderr: "" };
      }

      throw new Error(`unexpected execFile call: ${file} ${args.join(" ")}`);
    });
    const manager = new ProviderInstallManager(providerRegistry, {
      platform: "linux",
      commandExists,
      runCommand: execFile,
    });

    const job = await manager.start("gemini");

    expect(job.strategyIds).toEqual(["npm-install-gemini"]);
    expect(job.steps.map((step) => step.id)).toEqual([
      "install-provider-gemini",
      "verify-provider-gemini",
    ]);

    await vi.waitFor(() => {
      expect(manager.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFile).toHaveBeenCalledWith("npm", ["install", "-g", "@google/gemini-cli"], {
      windowsHide: true,
    });
  });

  it("executes OpenCode's npm install strategy on Linux", async () => {
    let opencodeInstalled = false;
    const commandExists = vi.fn(async (command: string) => {
      if (command === "npm") {
        return true;
      }
      if (command === "opencode") {
        return opencodeInstalled;
      }
      return false;
    });
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === "npm" && args.join(" ") === "install -g opencode-ai") {
        opencodeInstalled = true;
        return { stdout: "installed opencode", stderr: "" };
      }

      throw new Error(`unexpected execFile call: ${file} ${args.join(" ")}`);
    });
    const manager = new ProviderInstallManager(providerRegistry, {
      platform: "linux",
      commandExists,
      runCommand: execFile,
    });

    const job = await manager.start("opencode");

    expect(job.strategyIds).toEqual(["npm-install-opencode"]);
    expect(job.steps.map((step) => step.id)).toEqual([
      "install-provider-opencode",
      "verify-provider-opencode",
    ]);

    await vi.waitFor(() => {
      expect(manager.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFile).toHaveBeenCalledWith("npm", ["install", "-g", "opencode-ai"], {
      windowsHide: true,
    });
  });

  it("executes Cursor Agent's official install script on Linux", async () => {
    let agentInstalled = false;
    const commandExists = vi.fn(async (command: string) => {
      if (command === "bash") {
        return true;
      }
      if (command === "agent") {
        return agentInstalled;
      }
      return false;
    });
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (
        file === "bash" &&
        args[0] === "-lc" &&
        args[1] === "curl https://cursor.com/install -fsS | bash"
      ) {
        agentInstalled = true;
        return { stdout: "installed cursor agent", stderr: "" };
      }

      throw new Error(`unexpected execFile call: ${file} ${args.join(" ")}`);
    });
    const manager = new ProviderInstallManager(providerRegistry, {
      platform: "linux",
      commandExists,
      runCommand: execFile,
    });

    const job = await manager.start("cursor");

    expect(job.strategyIds).toEqual(["cursor-install-script"]);
    expect(job.steps.map((step) => step.id)).toEqual([
      "install-provider-agent",
      "verify-provider-cursor",
    ]);

    await vi.waitFor(() => {
      expect(manager.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFile).toHaveBeenCalledWith(
      "bash",
      ["-lc", "curl https://cursor.com/install -fsS | bash"],
      { windowsHide: true }
    );
  });

  it("keeps Cursor Agent manual-only on native Windows", async () => {
    const manager = new ProviderInstallManager(providerRegistry, {
      platform: "win32",
      commandExists: vi.fn(async () => false),
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start("cursor");

    expect(job).toMatchObject({
      providerId: "cursor",
      status: "failed",
      strategyIds: [],
      failure: {
        code: "unsupported_platform",
        providerId: "cursor",
        missingCommands: ["agent"],
      },
    });
    expect(job.steps).toEqual([
      expect.objectContaining({
        id: "install-provider-agent",
        kind: "check",
        command: "agent",
        status: "failed",
      }),
    ]);
  });
});
