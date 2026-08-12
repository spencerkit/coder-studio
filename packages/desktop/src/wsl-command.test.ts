import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createWslCommandRunner, runWslCommandChecked, type WslSpawn } from "./wsl-command.js";

function createChild() {
  const events = new EventEmitter();
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    once: events.once.bind(events),
    emit: events.emit.bind(events),
  };
}

describe("wsl-command", () => {
  it("turns an early stdin close into a checked command error instead of an uncaught event", async () => {
    const child = createChild();
    const spawnProcess = vi.fn(() => child) as unknown as WslSpawn;
    const runner = createWslCommandRunner(spawnProcess);
    const resultPromise = runWslCommandChecked(
      ["--distribution", "Ubuntu-24.04", "--exec", "/bin/sh"],
      Buffer.alloc(1024),
      runner
    );

    child.stderr.write("installation failed");
    child.stdin.emit("error", new Error("write EOF"));
    child.emit("close", 73);

    await expect(resultPromise).rejects.toThrow(
      "wsl.exe exited with code 73: installation failed\nwsl.exe stdin failed: write EOF"
    );
  });

  it("fails a zero-exit command when its input stream was not fully written", async () => {
    const child = createChild();
    const runner = createWslCommandRunner((() => child) as unknown as WslSpawn);
    const resultPromise = runWslCommandChecked(["--exec", "true"], Buffer.from("payload"), runner);

    child.stdin.emit("error", new Error("write EPIPE"));
    child.emit("close", 0);

    await expect(resultPromise).rejects.toThrow(
      "wsl.exe exited with code -1: wsl.exe stdin failed: write EPIPE"
    );
  });
});
