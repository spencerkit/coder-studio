import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const buildDevServerEnv = vi.fn(() => ({ PATH: "/tmp/dev-bin" }));
const runBackground = vi.fn();
const waitForProcesses = vi.fn(() => Promise.resolve());

vi.mock("./shared/index.js", () => ({
  buildDevServerEnv,
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
    runBackground.mockReset();
    waitForProcesses.mockClear();
  });

  it("forces development NODE_ENV for the backend watch child", async () => {
    const viteChild = createChildProcess();
    const serverChild = createChildProcess();
    runBackground.mockReturnValueOnce(viteChild).mockReturnValueOnce(serverChild);
    const { dev } = await import("./dev.js");

    await dev();

    expect(runBackground).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["tsx", "watch", "src/main.ts"],
      expect.objectContaining({ cwd: "/repo/packages/server" })
    );
    expect(buildDevServerEnv).toHaveBeenCalledWith({
      rootDir: "/repo",
      cliDir: "/repo/packages/cli",
      env: expect.objectContaining({
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: "4173",
      }),
    });
  });
});
