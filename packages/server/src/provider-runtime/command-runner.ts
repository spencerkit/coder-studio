import { spawn } from "node:child_process";
import { shouldUseShellForCommand } from "@coder-studio/utils";

export type CommandRunnerOptions = {
  windowsHide?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
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
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options?.cwd,
      env: options?.env,
      shell: shouldUseShellForCommand(file, process.platform),
      windowsHide: options?.windowsHide ?? true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.on("error", (error) => {
      reject(
        Object.assign(error, {
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        })
      );
    });

    child.on("close", (code) => {
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
