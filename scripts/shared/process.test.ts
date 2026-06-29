import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { run, waitForProcesses } from "./process.js";

function createChildProcess() {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true) as unknown as ChildProcess["kill"];
  return child;
}

describe("process utilities", () => {
  it("rejects and terminates sibling processes when one child exits non-zero", async () => {
    const failingProcess = createChildProcess();
    const siblingProcess = createChildProcess();
    const wait = waitForProcesses([failingProcess, siblingProcess]);

    failingProcess.emit("close", 1, null);

    await expect(wait).rejects.toThrow("Process exited with code 1");
    expect(siblingProcess.kill).toHaveBeenCalledWith("SIGTERM");
    expect(failingProcess.kill).not.toHaveBeenCalled();
  });

  it("resolves when all child processes exit successfully", async () => {
    const firstProcess = createChildProcess();
    const secondProcess = createChildProcess();
    const wait = waitForProcesses([firstProcess, secondProcess]);

    firstProcess.emit("close", 0, null);
    secondProcess.emit("close", 0, null);

    await expect(wait).resolves.toBeUndefined();
  });

  it("includes captured stderr in run() failures when stdio is piped", async () => {
    await expect(
      run(
        process.execPath,
        ["-e", "process.stderr.write('ERR_PNPM_NO_OFFLINE_META\\n'); process.exit(1);"],
        { stdio: "pipe" }
      )
    ).rejects.toThrow("ERR_PNPM_NO_OFFLINE_META");
  });

  it("includes captured stdout in run() failures when stdio is piped", async () => {
    await expect(
      run(
        process.execPath,
        ["-e", "process.stdout.write('ERR_PNPM_NO_OFFLINE_META\\n'); process.exit(1);"],
        { stdio: "pipe" }
      )
    ).rejects.toThrow("ERR_PNPM_NO_OFFLINE_META");
  });
});
