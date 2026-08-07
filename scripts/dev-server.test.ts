import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const buildDevServerEnv = vi.fn(() => ({ PATH: "/tmp/dev-bin" }));
const runBackground = vi.fn();

vi.mock("./shared/index.js", () => ({
  buildDevServerEnv,
  CLI_DIR: "/repo/packages/cli",
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  ROOT_DIR: "/repo",
  SERVER_DIR: "/repo/packages/server",
  success: vi.fn(),
}));

vi.mock("./shared/process.js", () => ({
  isDirectExecution: vi.fn(() => false),
  runBackground,
}));

function createChildProcess() {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true) as unknown as ChildProcess["kill"];
  return child;
}

describe("dev-server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    runBackground.mockReset();
  });

  it("exits with the backend watch child status when it closes", async () => {
    const child = createChildProcess();
    runBackground.mockReturnValue(child);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    const { devServer } = await import("./dev-server.js");

    await devServer();
    expect(() => child.emit("close", 7, null)).toThrow("process.exit called");

    expect(exit).toHaveBeenCalledWith(7);
  });

  it("forces development NODE_ENV for the backend watch child", async () => {
    const child = createChildProcess();
    runBackground.mockReturnValue(child);
    const { devServer } = await import("./dev-server.js");

    await devServer();

    expect(runBackground).toHaveBeenCalledWith(
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
