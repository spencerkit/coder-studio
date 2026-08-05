import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DESKTOP_DIR, ROOT_DIR } from "./shared/index.js";
import { error, info, step, success } from "./shared/logger.js";
import { isDirectExecution } from "./shared/process.js";

const DESKTOP_READY_PREFIX = "CODER_STUDIO_DESKTOP_READY ";
const DESKTOP_SHUTDOWN_MESSAGE = "CODER_STUDIO_DESKTOP_SHUTDOWN";
const SMOKE_TIMEOUT_MS = 60_000;

interface ReadyMessage {
  type: "ready";
  host: string;
  port: number;
  pid: number;
}

interface SmokeResult {
  loaded: boolean;
  backend: {
    source: "managed" | "external";
    url: string;
    pid: number | null;
  } | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findResourcesDir(): Promise<string> {
  const override = process.env.CODER_STUDIO_DESKTOP_RESOURCES_DIR?.trim();
  if (override) return resolve(override);

  const releaseDir = resolve(ROOT_DIR, "release/desktop");
  const candidates =
    process.platform === "win32"
      ? [join(releaseDir, "win-unpacked", "resources")]
      : process.platform === "darwin"
        ? [
            join(releaseDir, "mac-arm64", "Coder Studio.app", "Contents", "Resources"),
            join(releaseDir, "mac", "Coder Studio.app", "Contents", "Resources"),
          ]
        : [join(releaseDir, "linux-unpacked", "resources")];
  candidates.push(resolve(DESKTOP_DIR, "dist"));

  for (const candidate of candidates) {
    if (
      (await exists(join(candidate, "factory-runtime", "server.mjs"))) &&
      (await exists(resolveNodePath(candidate)))
    ) {
      return candidate;
    }
  }
  throw new Error(
    "No prepared desktop resources directory was found. Run pnpm pack:desktop first."
  );
}

async function verifyProductionResources(resourcesDir: string): Promise<void> {
  const roots = [join(resourcesDir, "factory-runtime"), join(resourcesDir, "engine")];
  const sourceMaps = (await Promise.all(roots.map((root) => readdir(root, { recursive: true }))))
    .flat()
    .filter((entry) => entry.endsWith(".map"));
  if (sourceMaps.length > 0) {
    throw new Error(`Packaged resources contain source maps: ${sourceMaps.slice(0, 5).join(", ")}`);
  }
}

function resolveNodePath(resourcesDir: string): string {
  return process.platform === "win32"
    ? join(resourcesDir, "engine", "node.exe")
    : join(resourcesDir, "engine", "bin", "node");
}

function resolveAppPath(resourcesDir: string): string | null {
  const unpackedDir = resolve(resourcesDir, "..");
  if (process.platform === "win32") return join(unpackedDir, "Coder Studio.exe");
  if (process.platform === "linux") return join(unpackedDir, "coder-studio");
  if (process.platform === "darwin") {
    return resolve(resourcesDir, "../MacOS/Coder Studio");
  }
  return null;
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = SMOKE_TIMEOUT_MS
): Promise<number | null> {
  return await new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      rejectExit(new Error(`Process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (spawnError) => {
      clearTimeout(timeout);
      rejectExit(spawnError);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
}

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<ReadyMessage> {
  const lines = createInterface({ input: child.stdout });
  return await new Promise((resolveReady, rejectReady) => {
    const stderr: string[] = [];
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("Packaged sidecar startup timed out")),
      30_000
    );

    const finish = (failure: Error | null, ready?: ReadyMessage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      if (failure) rejectReady(failure);
      else resolveReady(ready as ReadyMessage);
    };

    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("error", (spawnError) => finish(spawnError));
    child.once("exit", (code) => {
      finish(new Error(`Packaged sidecar exited with ${code}: ${stderr.join("")}`));
    });
    lines.on("line", (line) => {
      if (!line.startsWith(DESKTOP_READY_PREFIX)) return;
      try {
        const ready = JSON.parse(line.slice(DESKTOP_READY_PREFIX.length)) as ReadyMessage;
        if (ready.type !== "ready" || ready.host !== "127.0.0.1" || ready.port <= 0) {
          throw new Error("Packaged sidecar returned a malformed ready message");
        }
        finish(null, ready);
      } catch (parseError) {
        finish(parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    });
  });
}

async function verifyNativePty(nodePath: string, engineDir: string): Promise<void> {
  const marker = "CODER_STUDIO_PTY_OK";
  const program = `
    const pty = require("./node_modules/node-pty");
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "echo ${marker}"]
      : ["-lc", "printf ${marker}"];
    const terminal = pty.spawn(command, args, {
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
    let output = "";
    const timeout = setTimeout(() => {
      console.error("PTY smoke timed out");
      process.exit(1);
    }, 10000);
    terminal.onData((chunk) => { output += chunk; });
    terminal.onExit(() => {
      clearTimeout(timeout);
      if (!output.includes("${marker}")) {
        console.error(output);
        process.exit(1);
      }
      process.exit(0);
    });
  `;
  const child = spawn(nodePath, ["--eval", program], {
    cwd: engineDir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const code = await waitForExit(child, 20_000);
  if (code !== 0) throw new Error(`Packaged node-pty smoke failed: ${stderr.join("")}`);
}

async function verifySidecar(resourcesDir: string, tempRoot: string): Promise<void> {
  const nodePath = resolveNodePath(resourcesDir);
  const engineDir = join(resourcesDir, "engine");
  const productRuntimeDir = join(resourcesDir, "factory-runtime");
  await verifyNativePty(nodePath, engineDir);

  const secret = "desktop-package-smoke-secret";
  const child = spawn(nodePath, [join(productRuntimeDir, "server.mjs")], {
    cwd: productRuntimeDir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_PATH: join(engineDir, "node_modules"),
      CODER_STUDIO_ENGINE_ROOT: engineDir,
      CODER_STUDIO_LOG_FORMAT: "json",
      CODER_STUDIO_MERMAID_RUNTIME_PATH: join(productRuntimeDir, "assets", "mermaid.min.js"),
      CODER_STUDIO_RUNTIME_DIR: join(tempRoot, "sidecar-runtime"),
      CODER_STUDIO_DESKTOP_SECRET: secret,
      CODER_STUDIO_DESKTOP_PORT: "0",
      CODER_STUDIO_DESKTOP_STATE_DIR: join(tempRoot, "sidecar-state"),
      CODER_STUDIO_DESKTOP_UPLOADS_DIR: join(tempRoot, "sidecar-uploads"),
      CODER_STUDIO_DESKTOP_APP_VERSION: "0.0.0-smoke",
      CODER_STUDIO_DESKTOP_WEB_ROOT: join(productRuntimeDir, "web"),
    },
  });

  try {
    const ready = await waitForReady(child);
    const origin = `http://${ready.host}:${ready.port}`;
    const health = await fetch(`${origin}/healthz`);
    if (!health.ok) throw new Error(`Packaged sidecar health check failed: ${health.status}`);

    const beforeLogin = (await fetch(`${origin}/auth/status`).then((response) =>
      response.json()
    )) as { authenticated?: boolean };
    if (beforeLogin.authenticated !== false) {
      throw new Error("Packaged sidecar unexpectedly authenticated an anonymous request");
    }

    const login = await fetch(`${origin}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: secret }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (!login.ok || !cookie) throw new Error(`Packaged sidecar login failed: ${login.status}`);
    const afterLogin = (await fetch(`${origin}/auth/status`, {
      headers: { cookie },
    }).then((response) => response.json())) as { authenticated?: boolean };
    if (afterLogin.authenticated !== true) {
      throw new Error("Packaged sidecar did not retain its authenticated session");
    }

    const exited = waitForExit(child, 15_000);
    child.stdin.write(`${DESKTOP_SHUTDOWN_MESSAGE}\n`);
    const code = await exited;
    if (code !== 0) throw new Error(`Packaged sidecar shutdown returned exit code ${code}`);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

async function verifyApp(resourcesDir: string, tempRoot: string): Promise<void> {
  if (basename(resourcesDir) !== "resources") {
    info("Skipping Electron window smoke because only staged resources are available");
    return;
  }

  const appPath = resolveAppPath(resourcesDir);
  if (!appPath || !(await exists(appPath))) {
    throw new Error(
      `Packaged desktop executable was not found: ${appPath ?? "unsupported platform"}`
    );
  }

  const resultPath = join(tempRoot, "app-smoke-result.json");
  const electronUserDataDir = join(tempRoot, "electron-user-data");
  const stateDir = join(electronUserDataDir, "data");
  const appEnv = { ...process.env };
  delete appEnv.CODER_STUDIO_DESKTOP_REUSE_SERVER;
  delete appEnv.CODER_STUDIO_DESKTOP_STATE_DIR;
  delete appEnv.CODER_STUDIO_DESKTOP_UPLOADS_DIR;
  const child = spawn(appPath, [`--user-data-dir=${electronUserDataDir}`], {
    cwd: resolve(resourcesDir, ".."),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...appEnv,
      CODER_STUDIO_DESKTOP_SMOKE_RESULT: resultPath,
    },
  });
  const stderr: string[] = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const code = await waitForExit(child);
  if (code !== 0)
    throw new Error(`Packaged Electron smoke exited with ${code}: ${stderr.join("")}`);

  const result = JSON.parse(await readFile(resultPath, "utf8")) as SmokeResult;
  if (!result.loaded || result.backend?.source !== "managed") {
    throw new Error(
      `Packaged Electron smoke returned an invalid result: ${JSON.stringify(result)}`
    );
  }
  if (!(await exists(stateDir))) {
    throw new Error(`Packaged Electron smoke did not create isolated state: ${stateDir}`);
  }
  if (await exists(join(stateDir, "server.lock"))) {
    throw new Error("Packaged Electron smoke left the backend state lock behind");
  }
}

export async function smokeDesktopPackage(): Promise<void> {
  step(
    "SMOKE DESKTOP",
    "Validating packaged Engine, Product Runtime, native PTY, and Electron window...\n"
  );
  const resourcesDir = await findResourcesDir();
  const tempRoot = await mkdtemp(join(tmpdir(), "coder-studio-desktop-package-smoke-"));
  try {
    info(`Resources: ${resourcesDir}`);
    await verifyProductionResources(resourcesDir);
    await verifySidecar(resourcesDir, tempRoot);
    await verifyApp(resourcesDir, tempRoot);
    success("Desktop package smoke passed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (isDirectExecution(import.meta.url)) {
  smokeDesktopPackage().catch((smokeError) => {
    error(
      smokeError instanceof Error ? smokeError.stack || smokeError.message : String(smokeError)
    );
    process.exit(1);
  });
}
