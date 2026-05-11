import { describe, expect, it, vi } from "vitest";
import { runE2eUi } from "./e2e-ui.js";

describe("runE2eUi", () => {
  it("cleans stale output directories before running playwright and report generation", async () => {
    const removeDir = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
    const runCommand = vi
      .fn<(command: string, args?: string[], options?: { cwd?: string }) => Promise<void>>()
      .mockResolvedValue(undefined);

    const code = await runE2eUi({
      repoRoot: "/repo",
      removeDir,
      runCommand,
    });

    expect(code).toBe(0);
    expect(removeDir).toHaveBeenCalledTimes(2);
    expect(removeDir).toHaveBeenNthCalledWith(1, "/repo/e2e-ui/output");
    expect(removeDir).toHaveBeenNthCalledWith(2, "/repo/e2e-ui/test-results");
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      ["--dir", "e2e-ui", "exec", "playwright", "test", "--config", "playwright.config.ts"],
      { cwd: "/repo" }
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["--dir", "e2e-ui", "exec", "tsx", "report/build-report.ts"],
      { cwd: "/repo" }
    );
  });

  it("still builds the report when the playwright run fails and returns a non-zero exit code", async () => {
    const runCommand = vi
      .fn<(command: string, args?: string[], options?: { cwd?: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("playwright failed"))
      .mockResolvedValueOnce(undefined);

    const code = await runE2eUi({
      repoRoot: "/repo",
      removeDir: vi.fn().mockResolvedValue(undefined),
      runCommand,
    });

    expect(code).toBe(1);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["--dir", "e2e-ui", "exec", "tsx", "report/build-report.ts"],
      { cwd: "/repo" }
    );
  });

  it("returns a non-zero exit code when report generation fails after a successful playwright run", async () => {
    const runCommand = vi
      .fn<(command: string, args?: string[], options?: { cwd?: string }) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("report failed"));

    const code = await runE2eUi({
      repoRoot: "/repo",
      removeDir: vi.fn().mockResolvedValue(undefined),
      runCommand,
    });

    expect(code).toBe(1);
    expect(runCommand).toHaveBeenCalledTimes(2);
  });
});
