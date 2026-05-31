import { describe, expect, it, vi } from "vitest";
import { buildSystemDependencyRuntimeStatus } from "../../system-deps/runtime-status.js";

describe("buildSystemDependencyRuntimeStatus", () => {
  it("uses commandExists as the availability gate before reading versions", async () => {
    const runCommand = vi.fn(async (file: string) => {
      if (file === "git") {
        return { stdout: "git version 2.49.0\n", stderr: "" };
      }
      if (file === "node") {
        return { stdout: "v24.1.0\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file}`);
    });

    const status = await buildSystemDependencyRuntimeStatus({
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "brew" || command === "node"),
      runCommand,
    });

    expect(status.dependencies.git).toMatchObject({
      dependencyId: "git",
      available: false,
      version: undefined,
      autoInstallSupported: true,
      installReadiness: "ready",
      packageManager: "brew",
    });
    expect(status.dependencies.node).toMatchObject({
      dependencyId: "node",
      available: true,
      version: "v24.1.0",
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith("node", ["--version"], { windowsHide: true });
  });

  it("marks git installable on macOS when brew exists but git is missing", async () => {
    const runCommand = vi.fn(async (file: string) => {
      if (file === "git") {
        throw Object.assign(new Error("missing git"), { exitCode: 127, stdout: "", stderr: "" });
      }
      if (file === "node") {
        return { stdout: "v24.1.0\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file}`);
    });

    const status = await buildSystemDependencyRuntimeStatus({
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "brew" || command === "node"),
      runCommand,
    });

    expect(status.dependencies.git).toMatchObject({
      dependencyId: "git",
      available: false,
      autoInstallSupported: true,
      installReadiness: "ready",
      packageManager: "brew",
    });
    expect(status.dependencies.node).toMatchObject({
      available: true,
      version: "v24.1.0",
    });
  });

  it("reports unsupported_package_manager when Linux has neither apt nor brew", async () => {
    const status = await buildSystemDependencyRuntimeStatus({
      platform: "linux",
      commandExists: vi.fn(async () => false),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    expect(status.dependencies.git.installReadiness).toBe("unsupported_package_manager");
    expect(status.dependencies.node.autoInstallSupported).toBe(false);
  });
});
