import { join } from "node:path";

export const AUTOMATION_CMD_FILE_NAME = "cmd.mjs";
export const AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN = "<absolute-mounted-skill-path>/cmd.mjs";

export function renderMountedAutomationCommand(targetPath: string): string {
  return `node "${join(targetPath, AUTOMATION_CMD_FILE_NAME)}"`;
}

export function renderMountedSkillContent(content: string, targetPath: string): string {
  return content.replaceAll(
    AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
    join(targetPath, AUTOMATION_CMD_FILE_NAME)
  );
}

export const BUILTIN_AUTOMATION_BRIDGE_SOURCE = `
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const requiredEnv = [
  "CODER_STUDIO_API_URL",
  "CODER_STUDIO_WORKSPACE_ID",
  "CODER_STUDIO_SESSION_TOKEN",
  "CODER_STUDIO_AUTOMATION_ENTRY",
];

for (const key of requiredEnv) {
  if (!process.env[key] || process.env[key].trim().length === 0) {
    console.error(\`Coder Studio automation is not available in this session. Missing \${key}.\`);
    process.exit(1);
  }
}

function resolveChildArgv() {
  const entryPath = process.env.CODER_STUDIO_AUTOMATION_ENTRY;
  if (!entryPath) {
    throw new Error("Missing CODER_STUDIO_AUTOMATION_ENTRY.");
  }

  if (!entryPath.endsWith(".ts")) {
    return [entryPath, ...process.argv.slice(2)];
  }

  const requireFromEntry = createRequire(pathToFileURL(entryPath));
  const tsxLoaderPath = requireFromEntry.resolve("tsx");
  return ["--import", tsxLoaderPath, entryPath, ...process.argv.slice(2)];
}

let childArgv;
try {
  childArgv = resolveChildArgv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const child = spawn(process.execPath, childArgv, {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
`.trim();
