import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";

import "../../commands/system-deps.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {
      broadcast: vi.fn(),
      sendToClient: () => true,
      sendBinaryToClient: () => true,
    } as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: {} as never,
    lspMgr: {} as never,
    providerRuntimeDeps: {
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "brew" || command === "git"),
      runCommand: vi.fn(async (file: string) => {
        if (file === "git") {
          return { stdout: "git version 2.49.0\n", stderr: "" };
        }
        if (file === "node") {
          throw Object.assign(new Error("missing node"), {
            exitCode: 127,
            stdout: "",
            stderr: "",
          });
        }
        return { stdout: "", stderr: "" };
      }),
    },
    ...overrides,
  };
}

describe("system deps commands", () => {
  it("returns runtime status through systemDeps.runtimeStatus", async () => {
    const result = await dispatch(
      { kind: "command", id: "sysdeps-status", op: "systemDeps.runtimeStatus", args: {} },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      dependencies: {
        git: { available: true },
        node: { available: false, autoInstallSupported: true },
      },
    });
  });

  it("returns install lifecycle errors when the manager is missing or the job id is unknown", async () => {
    const unavailable = await dispatch(
      {
        kind: "command",
        id: "sysdeps-start-missing",
        op: "systemDeps.install.start",
        args: { dependencyId: "git" },
      },
      createContext()
    );
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error?.code).toBe("system_dependency_install_unavailable");

    const contextWithManager = createContext({
      systemDependencyInstallMgr: {
        start: vi.fn(async () => ({
          jobId: "job-1",
          dependencyId: "git",
          status: "queued",
          steps: [],
          interaction: { kind: "none", echo: false },
        })),
        get: vi.fn(() => undefined),
        submitInput: vi.fn(),
        cancel: vi.fn(),
      } as never,
    });

    const missingJob = await dispatch(
      {
        kind: "command",
        id: "sysdeps-get-missing",
        op: "systemDeps.install.get",
        args: { jobId: "missing-job" },
      },
      contextWithManager
    );
    expect(missingJob.ok).toBe(false);
    expect(missingJob.error?.code).toBe("system_dependency_install_job_not_found");
  });

  it("binds install lifecycle commands to the owner client", async () => {
    const start = vi.fn(async (_dependencyId: string, ownerClientId: string) => ({
      jobId: "job-1",
      dependencyId: "git",
      status: "queued",
      steps: [],
      interaction: { kind: "none", echo: false },
      ownerClientId,
    }));
    const get = vi.fn((jobId: string, ownerClientId: string) => {
      if (jobId === "job-1" && ownerClientId === "client-a") {
        return {
          jobId,
          dependencyId: "git",
          status: "running",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }
      return undefined;
    });
    const submitInput = vi.fn(async (jobId: string, ownerClientId: string, text: string) => ({
      jobId,
      dependencyId: "git",
      status: "running",
      steps: [],
      interaction: { kind: "none", echo: false },
      ownerClientId,
      submittedText: text,
    }));
    const cancel = vi.fn(async (jobId: string, ownerClientId: string) => ({
      jobId,
      dependencyId: "git",
      status: "cancelled",
      steps: [],
      interaction: { kind: "none", echo: false },
      ownerClientId,
    }));

    const context = createContext({
      systemDependencyInstallMgr: {
        start,
        get,
        submitInput,
        cancel,
      } as never,
    });

    const started = await dispatch(
      {
        kind: "command",
        id: "sysdeps-start-owner",
        op: "systemDeps.install.start",
        args: { dependencyId: "git" },
      },
      context,
      "client-a"
    );

    expect(started.ok).toBe(true);
    expect(start).toHaveBeenCalledWith("git", "client-a");

    const ownerGet = await dispatch(
      {
        kind: "command",
        id: "sysdeps-get-owner",
        op: "systemDeps.install.get",
        args: { jobId: "job-1" },
      },
      context,
      "client-a"
    );
    expect(ownerGet.ok).toBe(true);
    expect(get).toHaveBeenCalledWith("job-1", "client-a");

    const forbiddenGet = await dispatch(
      {
        kind: "command",
        id: "sysdeps-get-forbidden",
        op: "systemDeps.install.get",
        args: { jobId: "job-1" },
      },
      context,
      "client-b"
    );
    expect(forbiddenGet.ok).toBe(false);
    expect(forbiddenGet.error?.code).toBe("system_dependency_install_job_not_found");

    const ownerInput = await dispatch(
      {
        kind: "command",
        id: "sysdeps-input-owner",
        op: "systemDeps.install.input",
        args: { jobId: "job-1", text: "hunter2\n" },
      },
      context,
      "client-a"
    );
    expect(ownerInput.ok).toBe(true);
    expect(submitInput).toHaveBeenCalledWith("job-1", "client-a", "hunter2\n");

    const ownerCancel = await dispatch(
      {
        kind: "command",
        id: "sysdeps-cancel-owner",
        op: "systemDeps.install.cancel",
        args: { jobId: "job-1" },
      },
      context,
      "client-a"
    );
    expect(ownerCancel.ok).toBe(true);
    expect(cancel).toHaveBeenCalledWith("job-1", "client-a");
  });
});
