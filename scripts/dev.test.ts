import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const buildDevServerEnv = vi.fn(() => ({ PATH: "/tmp/dev-bin" }));
const ensureWslRuntimeEntryBuilt = vi.fn(
  async () => "/repo/packages/cli/dist/esm/wsl-runtime-entry.mjs"
);
const runBackground = vi.fn();
const waitForProcesses = vi.fn(() => Promise.resolve());

vi.mock("./shared/index.js", () => ({
  buildDevServerEnv,
  ensureWslRuntimeEntryBuilt,
  CLI_DIR: "/repo/packages/cli",
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  ROOT_DIR: "/repo",
  SERVER_DIR: "/repo/packages/server",
  step: vi.fn(),
  success: vi.fn(),
  WEB_DIR: "/repo/packages/web",
}));

vi.mock("./shared/process.js", () => ({
  isDirectExecution: vi.fn(() => false),
  runBackground,
  waitForProcesses,
}));

function createChildProcess() {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true) as unknown as ChildProcess["kill"];
  return child;
}

describe("dev", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    buildDevServerEnv.mockClear();
    ensureWslRuntimeEntryBuilt.mockClear();
    runBackground.mockReset();
    waitForProcesses.mockClear();
  });

  it("forces development NODE_ENV for the backend watch child", async () => {
    const viteChild = createChildProcess();
    const serverChild = createChildProcess();
    runBackground.mockReturnValueOnce(viteChild).mockReturnValueOnce(serverChild);
    const { dev } = await import("./dev.js");

    await dev();

    expect(ensureWslRuntimeEntryBuilt).toHaveBeenCalledTimes(1);
    expect(buildDevServerEnv).toHaveBeenCalledWith({
      rootDir: "/repo",
      cliDir: "/repo/packages/cli",
      env: expect.objectContaining({
        NODE_ENV: "development",
        HOST: "0.0.0.0",
        PORT: "4173",
      }),
    });
  });
});
