import { spawn } from "node:child_process";
import {
  type CommandAvailabilityCheck,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import { type CommandRunner } from "../provider-runtime/command-runner.js";
import { decodeWindowsConsoleOutput } from "../terminal-profiles/wsl.js";

export interface WslDiscoveryDeps {
  commandExists?: CommandAvailabilityCheck;
  runCommand?: CommandRunner;
}

async function hasWslCommand(
  commandExists?: CommandAvailabilityCheck,
  runCommand?: CommandRunner
): Promise<boolean> {
  const checker =
    commandExists ??
    ((command: string) =>
      checkCommandAvailable(command, {
        runCommand,
      }));

  return (await checker("wsl")) || (await checker("wsl.exe"));
}

export function parseWslDistroLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function listWslDistros(input: WslDiscoveryDeps = {}): Promise<string[]> {
  if (!(await hasWslCommand(input.commandExists, input.runCommand))) {
    return [];
  }

  const stdout = input.runCommand
    ? (await input.runCommand("wsl.exe", ["-l", "-q"], { windowsHide: true })).stdout
    : await runWslListStdout();
  return parseWslDistroLines(stdout);
}

function runWslListStdout(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-l", "-q"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`wsl.exe exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve(decodeWindowsConsoleOutput(Buffer.concat(stdoutChunks)));
    });
  });
}
