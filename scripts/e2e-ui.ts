import { rm } from "node:fs/promises";
import { join } from "node:path";
import { error, info, success } from "./shared/logger.js";
import { ROOT_DIR } from "./shared/paths.js";
import { isDirectExecution, run } from "./shared/process.js";

export interface E2eUiRunnerDeps {
  repoRoot?: string;
  removeDir?: (target: string) => Promise<void>;
  runCommand?: (command: string, args?: string[], options?: { cwd?: string }) => Promise<void>;
}

const E2E_UI_DIR = "e2e-ui";
const PLAYWRIGHT_ARGS = [
  "--dir",
  E2E_UI_DIR,
  "exec",
  "playwright",
  "test",
  "--config",
  "playwright.config.ts",
];
const REPORT_ARGS = ["--dir", E2E_UI_DIR, "exec", "tsx", "report/build-report.ts"];

export async function runE2eUi(deps: E2eUiRunnerDeps = {}): Promise<number> {
  const repoRoot = deps.repoRoot ?? ROOT_DIR;
  const removeDir =
    deps.removeDir ??
    (async (target: string) => {
      await rm(target, { recursive: true, force: true });
    });
  const runCommand =
    deps.runCommand ??
    ((command: string, args: string[] = [], options?: { cwd?: string }) =>
      run(command, args, { cwd: options?.cwd }));

  const outputDir = join(repoRoot, E2E_UI_DIR, "output");
  const testResultsDir = join(repoRoot, E2E_UI_DIR, "test-results");

  await Promise.all([removeDir(outputDir), removeDir(testResultsDir)]);

  let exitCode = 0;

  try {
    info("Running e2e-ui Playwright capture suite...");
    await runCommand("pnpm", PLAYWRIGHT_ARGS, { cwd: repoRoot });
    success("e2e-ui Playwright capture suite finished.");
  } catch (cause) {
    exitCode = 1;
    error(
      cause instanceof Error
        ? cause.message
        : "e2e-ui Playwright capture suite failed unexpectedly."
    );
  }

  try {
    info("Building e2e-ui report...");
    await runCommand("pnpm", REPORT_ARGS, { cwd: repoRoot });
    success("e2e-ui report generated.");
  } catch (cause) {
    if (exitCode === 0) {
      exitCode = 1;
    }
    error(cause instanceof Error ? cause.message : "e2e-ui report generation failed unexpectedly.");
  }

  return exitCode;
}

if (isDirectExecution(import.meta.url)) {
  void runE2eUi().then((code) => {
    process.exit(code);
  });
}
