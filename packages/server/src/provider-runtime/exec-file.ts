import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(nodeExecFile);

export type ExecFileOptions = { windowsHide?: boolean };

export interface ExecFileStringResult {
  stdout: string;
  stderr: string;
}

export type ExecFileRunner = (
  file: string,
  args: string[],
  options?: ExecFileOptions
) => Promise<ExecFileStringResult>;

export async function execFileAsString(
  file: string,
  args: string[],
  options?: ExecFileOptions
): Promise<ExecFileStringResult> {
  const result = await execFileAsync(file, args, options);
  return {
    stdout: coerceOutput(result.stdout),
    stderr: coerceOutput(result.stderr),
  };
}

function coerceOutput(output: string | Uint8Array): string {
  return typeof output === "string" ? output : Buffer.from(output).toString("utf8");
}
