import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface WslCommandResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export type WslCommandRunner = (args: string[], input?: Buffer) => Promise<WslCommandResult>;

interface WslChildProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (exitCode: number | null) => void): this;
}

export type WslSpawn = (args: string[]) => WslChildProcess;

export function decodeWindowsConsoleOutput(buffer: Buffer): string {
  if (buffer.length === 0) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le", 2);
  const nullBytes = buffer.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  return nullBytes > 0 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

const spawnWsl: WslSpawn = (args) =>
  spawn("wsl.exe", args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

export function createWslCommandRunner(spawnProcess: WslSpawn): WslCommandRunner {
  return (args, input) =>
    new Promise<WslCommandResult>((resolveResult, rejectResult) => {
      const child = spawnProcess(args);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdinError: Error | null = null;
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.stdin.on("error", (writeError: Error) => {
        stdinError = writeError;
      });
      child.once("error", rejectResult);
      child.once("close", (exitCode) => {
        if (stdinError) {
          const prefix = stderr.length > 0 ? "\n" : "";
          stderr.push(Buffer.from(`${prefix}wsl.exe stdin failed: ${stdinError.message}`, "utf8"));
        }
        resolveResult({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          exitCode: exitCode === 0 && stdinError ? -1 : (exitCode ?? -1),
        });
      });
      if (input) child.stdin.end(input);
      else child.stdin.end();
    });
}

export const runWslCommand: WslCommandRunner = createWslCommandRunner(spawnWsl);

export async function runWslCommandChecked(
  args: string[],
  input?: Buffer,
  runner: WslCommandRunner = runWslCommand
): Promise<WslCommandResult> {
  const result = await runner(args, input);
  if (result.exitCode !== 0) {
    const details = decodeWindowsConsoleOutput(result.stderr).trim();
    throw new Error(`wsl.exe exited with code ${result.exitCode}${details ? `: ${details}` : ""}`);
  }
  return result;
}
