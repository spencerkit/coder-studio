import { spawn } from "node:child_process";
import {
  type HeadlessSpawnCommand,
  prepareHeadlessSpawnCommand,
  shouldUseShellForCommand,
} from "@coder-studio/utils";

export type CommandRunnerOptions = {
  windowsHide?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** When set, long prompts are delivered via stdin instead of argv. */
  prompt?: string;
};

export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  file: string,
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandRunnerResult>;

export async function runCommandAsString(
  file: string,
  args: string[],
  options?: CommandRunnerOptions
): Promise<CommandRunnerResult> {
  const baseCommand: HeadlessSpawnCommand = {
    argv: [file, ...args],
    cwd: options?.cwd,
  };
  const prepared = options?.prompt
    ? prepareHeadlessSpawnCommand(baseCommand, options.prompt)
    : baseCommand;

  return new Promise((resolve, reject) => {
    const stdio: ["pipe" | "ignore", "pipe", "pipe"] =
      prepared.stdin !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];

    const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
      cwd: prepared.cwd ?? options?.cwd,
      env: options?.env,
      shell: shouldUseShellForCommand(prepared.argv[0]!, process.platform),
      stdio,
      windowsHide: options?.windowsHide ?? true,
    });

    if (prepared.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(prepared.stdin);
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timeoutId =
      typeof options?.timeoutMs === "number" && options.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            child.kill?.("SIGKILL");
            reject(
              Object.assign(new Error(`Command timed out after ${options.timeoutMs}ms`), {
                code: "command_timeout",
                timeoutMs: options.timeoutMs,
                stdout: Buffer.concat(stdoutChunks).toString("utf8"),
                stderr: Buffer.concat(stderrChunks).toString("utf8"),
              })
            );
          }, options.timeoutMs)
        : null;
    timeoutId?.unref?.();

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(
        Object.assign(error, {
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        })
      );
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        Object.assign(new Error(`Command failed with exit code ${code ?? "unknown"}`), {
          exitCode: code ?? undefined,
          stdout,
          stderr,
        })
      );
    });
  });
}
