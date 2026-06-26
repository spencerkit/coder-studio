import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_CMD_FILE_NAME,
  BUILTIN_AUTOMATION_BRIDGE_SOURCE,
} from "../../skills/builtin/automation-bridge.js";

function runNodeScript(
  entryPath: string,
  options: {
    args?: string[];
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath, ...(options.args ?? [])], {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stderr, stdout });
    });
  });
}

describe("builtin automation bridge", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when required environment is missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-automation-bridge-"));
    const bridgePath = join(tempDir, AUTOMATION_CMD_FILE_NAME);
    await writeFile(bridgePath, BUILTIN_AUTOMATION_BRIDGE_SOURCE, "utf8");

    const result = await runNodeScript(bridgePath, {
      env: {
        PATH: process.env.PATH,
      },
    });

    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain("CODER_STUDIO_API_URL");
  });

  it("delegates to the injected automation entry and preserves exit code", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-automation-bridge-"));
    const bridgePath = join(tempDir, AUTOMATION_CMD_FILE_NAME);
    const automationEntryPath = join(tempDir, "automation-entry.mjs");
    await writeFile(bridgePath, BUILTIN_AUTOMATION_BRIDGE_SOURCE, "utf8");
    await writeFile(
      automationEntryPath,
      [
        "import { writeFileSync } from 'node:fs';",
        "const outputPath = process.argv[2];",
        "writeFileSync(outputPath, JSON.stringify(process.argv.slice(3)));",
        "process.exit(17);",
      ].join("\n"),
      "utf8"
    );

    const argvCapturePath = join(tempDir, "argv.json");
    const result = await runNodeScript(bridgePath, {
      args: [argvCapturePath, "alpha", "beta"],
      env: {
        ...process.env,
        CODER_STUDIO_API_URL: "http://127.0.0.1:3000",
        CODER_STUDIO_WORKSPACE_ID: "workspace-123",
        CODER_STUDIO_SESSION_TOKEN: "session-token",
        CODER_STUDIO_AUTOMATION_ENTRY: automationEntryPath,
      },
    });

    expect(result.code).toBe(17);
    expect(result.signal).toBeNull();
    expect(JSON.parse(await readFile(argvCapturePath, "utf8"))).toEqual(["alpha", "beta"]);
  });

  it("runs TypeScript automation entries through tsx when the injected entry is a source file", async () => {
    tempDir = await mkdtemp(join(process.cwd(), ".coder-studio-automation-bridge-"));
    const bridgePath = join(tempDir, AUTOMATION_CMD_FILE_NAME);
    const automationEntryPath = join(tempDir, "automation-entry.ts");
    const argvCapturePath = join(tempDir, "argv.json");
    await writeFile(bridgePath, BUILTIN_AUTOMATION_BRIDGE_SOURCE, "utf8");
    await writeFile(
      join(tempDir, "message.ts"),
      "export const message = 'from-ts-helper';\n",
      "utf8"
    );
    await writeFile(
      automationEntryPath,
      [
        "import { writeFileSync } from 'node:fs';",
        "import { message } from './message.js';",
        "const outputPath = process.argv[2];",
        "writeFileSync(outputPath, JSON.stringify({ message, args: process.argv.slice(3) }));",
        "process.exit(23);",
      ].join("\n"),
      "utf8"
    );

    const result = await runNodeScript(bridgePath, {
      args: [argvCapturePath, "alpha", "beta"],
      env: {
        ...process.env,
        CODER_STUDIO_API_URL: "http://127.0.0.1:3000",
        CODER_STUDIO_WORKSPACE_ID: "workspace-123",
        CODER_STUDIO_SESSION_TOKEN: "session-token",
        CODER_STUDIO_AUTOMATION_ENTRY: automationEntryPath,
      },
    });

    expect(result.code).toBe(23);
    expect(result.signal).toBeNull();
    expect(JSON.parse(await readFile(argvCapturePath, "utf8"))).toEqual({
      message: "from-ts-helper",
      args: ["alpha", "beta"],
    });
  });
});
