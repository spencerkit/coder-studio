import { spawn } from "node:child_process";

export interface WslCommandResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export type WslCommandRunner = (args: string[], input?: Buffer) => Promise<WslCommandResult>;

export function decodeWindowsConsoleOutput(buffer: Buffer): string {
  if (buffer.length === 0) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le", 2);
  const nullBytes = buffer.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  return nullBytes > 0 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

export const runWslCommand: WslCommandRunner = (args, input) =>
  new Promise<WslCommandResult>((resolveResult, rejectResult) => {
    const child = spawn("wsl.exe", args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectResult);
    child.once("close", (exitCode) => {
      resolveResult({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: exitCode ?? -1,
      });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });

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
