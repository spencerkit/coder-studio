import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TestWorkspace {
  path: string;
  gitInitialized: boolean;
}

export async function createTestWorkspace(): Promise<TestWorkspace> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "coder-studio-phase1-"));

  try {
    await fs.writeFile(path.join(workspacePath, "README.md"), "# Test Workspace\n");
    await fs.mkdir(path.join(workspacePath, "src"));
    await fs.writeFile(path.join(workspacePath, "src", "index.ts"), "export const ok = true;\n");
    await execFileAsync("git", ["init"], { cwd: workspacePath });
    await execFileAsync("git", ["add", "."], { cwd: workspacePath });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: workspacePath });
    return { path: workspacePath, gitInitialized: true };
  } catch (error) {
    // Clean up temp directory on failure
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup errors - original error is more important
    });
    throw error;
  }
}

export async function deleteTestWorkspace(workspace: TestWorkspace): Promise<void> {
  await fs.rm(workspace.path, { recursive: true, force: true });
}
