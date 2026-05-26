import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isSystemDependencyId,
  SYSTEM_DEPENDENCY_IDS,
  SYSTEM_DEPENDENCY_INSTALL_OUTPUT_TOPIC_SCOPE,
  type SystemDependencyId,
  type SystemDependencyInstallFailure,
  type SystemDependencyInstallInteraction,
  type SystemDependencyInstallJobSnapshot,
  type SystemDependencyInstallOutputChunk,
  type SystemDependencyInstallStepSnapshot,
  type SystemDependencyPackageManager,
  type SystemDependencyRuntimeEntry,
  type SystemDependencyRuntimeStatusResponse,
} from "../index";

describe("system dependency install shared contract", () => {
  it("defines the supported system dependency ids", () => {
    expect(SYSTEM_DEPENDENCY_IDS).toEqual(["git", "node"]);
  });

  it("identifies supported system dependency ids", () => {
    expect(isSystemDependencyId("git")).toBe(true);
    expect(isSystemDependencyId("node")).toBe(true);
    expect(isSystemDependencyId("python")).toBe(false);
  });

  it("defines the install output topic scope", () => {
    expect(SYSTEM_DEPENDENCY_INSTALL_OUTPUT_TOPIC_SCOPE).toBe("systemDeps.install");
  });

  it("keeps the shared type surface stable through the public barrel", () => {
    expectTypeOf<SystemDependencyId>().toEqualTypeOf<"git" | "node">();
    expectTypeOf<SystemDependencyPackageManager>().toEqualTypeOf<
      "brew" | "apt-get" | "dnf" | "yum" | "pacman" | "zypper"
    >();

    expectTypeOf<SystemDependencyRuntimeEntry>().toEqualTypeOf<{
      dependencyId: "git" | "node";
      available: boolean;
      version?: string;
      autoInstallSupported: boolean;
      installReadiness: "ready" | "unsupported_platform" | "unsupported_package_manager";
      packageManager?: "brew" | "apt-get" | "dnf" | "yum" | "pacman" | "zypper";
      manualGuideKeys: string[];
      docUrl?: string;
    }>();

    expectTypeOf<SystemDependencyRuntimeStatusResponse>().toEqualTypeOf<{
      dependencies: Record<"git" | "node", SystemDependencyRuntimeEntry>;
    }>();

    expectTypeOf<SystemDependencyInstallInteraction>().toEqualTypeOf<{
      kind: "none" | "sudo_password" | "confirm";
      promptExcerpt?: string;
      echo: boolean;
    }>();

    expectTypeOf<SystemDependencyInstallStepSnapshot>().toEqualTypeOf<{
      id: string;
      titleKey: string;
      kind: "check" | "install" | "verify";
      command: string;
      args: string[];
      status: "pending" | "running" | "succeeded" | "failed";
      startedAt?: number;
      finishedAt?: number;
      exitCode?: number;
      stdoutExcerpt?: string;
      stderrExcerpt?: string;
    }>();

    expectTypeOf<SystemDependencyInstallFailure>().toEqualTypeOf<{
      code:
        | "unsupported_platform"
        | "unsupported_package_manager"
        | "permission_denied"
        | "user_cancelled"
        | "pty_disconnected"
        | "command_not_found"
        | "command_failed"
        | "verification_failed"
        | "unknown_failure";
      dependencyId: "git" | "node";
      failedStepId: string;
      message: string;
      command: string;
      args: string[];
      exitCode?: number;
      stdoutExcerpt?: string;
      stderrExcerpt?: string;
      packageManager?: "brew" | "apt-get" | "dnf" | "yum" | "pacman" | "zypper";
      manualGuideKeys: string[];
      docUrl?: string;
    }>();

    expectTypeOf<SystemDependencyInstallJobSnapshot>().toEqualTypeOf<{
      jobId: string;
      dependencyId: "git" | "node";
      status: "queued" | "running" | "waiting_input" | "succeeded" | "failed" | "cancelled";
      packageManager?: "brew" | "apt-get" | "dnf" | "yum" | "pacman" | "zypper";
      currentStepId?: string;
      steps: SystemDependencyInstallStepSnapshot[];
      interaction: SystemDependencyInstallInteraction;
      failure?: SystemDependencyInstallFailure;
    }>();

    expectTypeOf<SystemDependencyInstallOutputChunk>().toEqualTypeOf<{
      jobId: string;
      chunk: string;
      seq: number;
    }>();
  });
});
