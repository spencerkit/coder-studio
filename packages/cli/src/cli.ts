import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { clearAuthBlockByIp, listAuthBlocks } from "./auth-control.js";
import { printCapabilities, printIdentify } from "./automation-client.js";
import { callCoderStudioCommand } from "./automation-command-client.js";
import { openBrowser } from "./browser.js";
import { type CliConfig, readCliConfig, writeCliConfig } from "./config-store.js";
import { readLogExcerpt } from "./log-excerpt.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import { getCliVersion } from "./package-manifest.js";
import { type CliArgs, parseArgs } from "./parse-args.js";
import { startManagedServer } from "./pm2-control.js";
import { confirmYesNo, isInteractiveSession } from "./prompts.js";
import { getServerStatus, type ServerStatus, stopRunningServer } from "./server-control.js";
import { prepareLocalStateStorage, startServer } from "./server-runner.js";
import { getBrowserUrl, getListenIp, getListenUrl } from "./server-url.js";

const MANAGED_SERVER_WAIT_MS = 15000;
const DEFAULT_LOG_TAIL_LINES = 40;
const PRIMARY_CLI_COMMAND = "coder-studio-cli";
const LEGACY_CLI_COMMAND = "coder-studio";

export interface CliMainOptions {
  entrypointName?: string;
}

function resolveCommandName(entrypointName?: string): string {
  return entrypointName?.trim() || PRIMARY_CLI_COMMAND;
}

function warnLegacyCommand(entrypointName?: string): void {
  if (resolveCommandName(entrypointName) !== LEGACY_CLI_COMMAND) {
    return;
  }

  console.warn(
    "The npm `coder-studio` command is deprecated and will be removed in a future release. Use `coder-studio-cli` instead."
  );
}

function formatConfig(config: CliConfig | null): string {
  return JSON.stringify(config ?? {}, null, 2);
}

function formatStatus(status: ServerStatus): string {
  const listenUrl = getListenUrl(status) ?? "n/a";
  const browserUrl = getBrowserUrl(status) ?? "n/a";
  const startedAt = status.startedAt === null ? "n/a" : new Date(status.startedAt).toISOString();

  return [
    `Status: ${status.status}`,
    `Listen host: ${status.host ?? "n/a"}`,
    `Listen IP: ${getListenIp(status) ?? "n/a"}`,
    `Port: ${status.port ?? "n/a"}`,
    `Listen URL: ${listenUrl}`,
    `Local URL: ${browserUrl}`,
    `PID: ${status.pid ?? "n/a"}`,
    `Started: ${startedAt}`,
    `Restarts: ${status.restartCount}`,
    `Out log: ${status.outFile}`,
    `Error log: ${status.errFile}`,
  ].join("\n");
}

function showLogs(
  status: ServerStatus,
  {
    tail = DEFAULT_LOG_TAIL_LINES,
    errorsOnly = false,
  }: { tail?: number; errorsOnly?: boolean } = {}
): void {
  const paths = errorsOnly ? [status.errFile] : [status.outFile, status.errFile];
  const contents = paths
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .flatMap((path) => {
      const content = readLogExcerpt(path, { maxLines: tail, maxChars: null });
      return content ? [content] : [];
    });

  console.log(contents.length === 0 ? "No logs available." : contents.join("\n"));
}

function showHelp(commandName: string): void {
  console.log(`
@spencer-kit/coder-studio - Coder Studio CLI

USAGE:
  ${commandName} [COMMAND]

COMMANDS:
  serve    Start the Coder Studio server in background (default)
  server   Alias for serve
  open     Start the server if needed and open Coder Studio in a browser
  auth     Manage auth login blocks in local server storage
  config   Persist CLI host/port/state-dir/password settings
  stop     Stop the managed Coder Studio server
  status   Show the managed server status
  logs     Show the managed server logs
  help     Show this help message
  identify      Print Coder Studio agent runtime context
  capabilities  Print read-only validation commands for agents
  workspace     Read workspace automation data
  session       Read session automation data
  terminal      Read terminal automation data
  git           Read git automation data
  ui            Dispatch UI actions to the active Coder Studio workspace
  canvas        Create, update, render, and list workspace canvases
  memory        Read and write workspace memory
  version  Show version

OPTIONS:
  --host <string>          Save server host for future runs
  --port, -p <number>      Save server port for future runs
  --state-dir, --data-dir, -d <path>  Save state directory for future runs
  --password <string>      Save auth password for future runs
  --restart                Restart an already running managed server for serve/open
  --help                   Show help
  --version, -v            Show version

EXAMPLES:
  ${commandName}
  ${commandName} serve
  ${commandName} server
  ${commandName} auth ban-list
  ${commandName} auth unblock --ip 198.51.100.24
  ${commandName} serve --foreground
  ${commandName} serve --restart
  ${commandName} open
  ${commandName} open --restart
  ${commandName} status
  ${commandName} logs
  ${commandName} identify --json
  ${commandName} capabilities --json
  ${commandName} workspace list --json
  ${commandName} session list --workspace ws_123 --json
  ${commandName} terminal read --terminal term_123 --bytes 4096 --json
  ${commandName} git status --workspace ws_123 --json
  ${commandName} git diff --workspace ws_123 --path src/a.ts --json
  ${commandName} ui open-file --workspace ws_123 --path src/a.ts --line 12 --json
  ${commandName} ui close-file --workspace ws_123 --path src/a.ts --json
  ${commandName} ui open-url --workspace ws_123 --url http://127.0.0.1:5173 --json
  ${commandName} ui close-url --workspace ws_123 --url http://127.0.0.1:5173 --json
  ${commandName} ui show-panel --workspace ws_123 --panel terminal --json
  ${commandName} canvas list --workspace ws_123 --json
  ${commandName} canvas create --workspace ws_123 --kind architecture_canvas --title "Runtime Flow" --document-json '{"summary":"Runtime flow","diagram":{"dsl":"mermaid","source":"flowchart LR\\nWebUI[Web UI] --> Server[Runtime Server]"},"annotations":[]}' --open --json
  ${commandName} canvas update --workspace ws_123 --canvas canvas_123 --document-json '{"summary":"Runtime flow","diagram":{"dsl":"mermaid","source":"flowchart LR\\nWebUI[Web UI] --> Server[Runtime Server]"},"annotations":[]}' --json
  ${commandName} canvas render --workspace ws_123 --canvas canvas_123 --json
  ${commandName} memory list --workspace ws_123 --json
  ${commandName} memory search architecture --workspace ws_123 --json
  ${commandName} memory add --workspace ws_123 --type wiki --content "This repo uses pnpm." --json
  ${commandName} memory add --workspace ws_123 --type issue --content "Verify release notes." --status pending_verification --json
  ${commandName} stop
  ${commandName} config --host 0.0.0.0 --port 8080
`);
}

function showConfigHelp(commandName: string): void {
  console.log(`
@spencer-kit/coder-studio - config

USAGE:
  ${commandName} config [OPTIONS]
  ${commandName} config help

BEHAVIOR:
  Without options, prints the current saved config.
  Bare serve reads this saved config for future runs.

OPTIONS:
  --host <string>          Save server host for future runs
  --port, -p <number>      Save server port for future runs
  --state-dir, --data-dir, -d <path>  Save state directory for future runs
  --password <string>      Save auth password for future runs
  --help                   Show config help

EXAMPLES:
  ${commandName} config
  ${commandName} config --host 0.0.0.0
  ${commandName} config --port 8080
  ${commandName} config --state-dir /tmp/cs-data
  ${commandName} config --password sekrit
  ${commandName} config --host 0.0.0.0 --port 8080
`);
}

function showVersion(): void {
  console.log(`@spencer-kit/coder-studio v${getCliVersion(import.meta.url)}`);
}

function printCommandResult(result: unknown, options: { json?: boolean } = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "text" in result &&
    typeof (result as { text?: unknown }).text === "string"
  ) {
    console.log((result as { text: string }).text);
    return;
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "diff" in result &&
    typeof (result as { diff?: unknown }).diff === "string"
  ) {
    console.log((result as { diff: string }).diff);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

function parseJsonOption(label: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function buildUiActionIntent(args: CliArgs): Record<string, unknown> {
  const workspace = args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {};

  switch (args.uiCommand) {
    case "open-file":
      return {
        type: "editor.openFile",
        ...workspace,
        path: args.path!,
        ...(args.line !== undefined ? { line: args.line } : {}),
        ...(args.column !== undefined ? { column: args.column } : {}),
      };
    case "close-file":
      return {
        type: "editor.closeFile",
        ...workspace,
        path: args.path!,
      };
    case "open-url":
      return {
        type: "browser.openUrl",
        ...workspace,
        url: args.url!,
      };
    case "close-url":
      return {
        type: "browser.closeUrl",
        ...workspace,
        url: args.url!,
      };
    case "open-canvas":
      return {
        type: "canvas.open",
        ...workspace,
        canvasId: args.canvasId!,
      };
    case "show-panel":
      return {
        type: "panel.show",
        ...workspace,
        panel: args.panel!,
      };
    case "focus-workspace":
      return {
        type: "workspace.focus",
        workspaceId: args.workspaceId!,
      };
    case "run-command":
      return {
        type: "command.run",
        commandId: args.uiCommandId!,
      };
    default:
      throw new Error("Missing ui subcommand");
  }
}

function resolveMemoryWorkspaceId(args: CliArgs): string {
  const workspaceId = args.workspaceId ?? process.env.CODER_STUDIO_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error("Missing workspace value");
  }

  return workspaceId;
}

function formatAuthBlocks(blocks: Awaited<ReturnType<typeof listAuthBlocks>>): string {
  if (blocks.length === 0) {
    return "No blocked IPs.";
  }

  return JSON.stringify(blocks, null, 2);
}

function resolveManagedScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "server-runner.js"),
    join(currentDir, "server-runner.mjs"),
    join(currentDir, "../src/server-runner.ts"),
  ];

  const scriptPath = candidates.find((candidate) => existsSync(candidate));
  if (!scriptPath) {
    throw new Error("Unable to locate the managed server entry script");
  }

  return scriptPath;
}

function isRunningStatus(status: ServerStatus): boolean {
  return status.status === "running" || status.status === "starting";
}

interface ManagedStartupDecision {
  existingStatus: ServerStatus | null;
  restartRequested: boolean;
}

async function shouldRestartRunningServer(status: ServerStatus): Promise<boolean> {
  const currentUrl = getBrowserUrl(status) ?? getListenUrl(status) ?? "the existing server";

  if (!isInteractiveSession()) {
    return false;
  }

  return confirmYesNo(`Coder Studio is already running at ${currentUrl}. Restart it? [y/N] `);
}

async function prepareManagedStartup(forceRestart = false): Promise<ManagedStartupDecision> {
  const status = await getServerStatus();
  if (!isRunningStatus(status)) {
    return {
      existingStatus: null,
      restartRequested: false,
    };
  }

  const restart = forceRestart ? true : await shouldRestartRunningServer(status);
  if (!restart) {
    const currentUrl = getBrowserUrl(status) ?? getListenUrl(status) ?? "n/a";
    if (!isInteractiveSession()) {
      console.log(
        `Coder Studio is already running at ${currentUrl}. Service already exists and was not restarted.`
      );
    } else {
      console.log(`Leaving the existing Coder Studio server running at ${currentUrl}.`);
    }
    return {
      existingStatus: status,
      restartRequested: false,
    };
  }

  console.log("Restarting the managed Coder Studio server...");
  return {
    existingStatus: null,
    restartRequested: true,
  };
}

async function startManagedServerFlow(): Promise<void> {
  await startManagedServer({
    script: resolveManagedScriptPath(),
    cwd: process.cwd(),
    waitMs: MANAGED_SERVER_WAIT_MS,
  });
}

async function openManagedServerInBrowser(existingStatus?: ServerStatus | null): Promise<void> {
  const status = existingStatus ?? (await getServerStatus());
  const browserUrl = getBrowserUrl(status);

  if (browserUrl === null) {
    throw new Error("Unable to determine the running Coder Studio URL.");
  }

  console.log(`Opening Coder Studio in your browser: ${browserUrl}`);
  await openBrowser(browserUrl);
}

export async function main(
  argv = process.argv.slice(2),
  options: CliMainOptions = {}
): Promise<void> {
  assertSupportedNodeVersion();
  const commandName = resolveCommandName(options.entrypointName);
  warnLegacyCommand(options.entrypointName);
  const args = parseArgs(argv);

  if (args.command === "config") {
    if (args.configHelp) {
      showConfigHelp(commandName);
      return;
    }

    if (
      args.host === undefined &&
      args.port === undefined &&
      args.stateDir === undefined &&
      args.password === undefined
    ) {
      console.log(formatConfig(readCliConfig()));
      return;
    }

    const savedConfig = readCliConfig();
    const nextConfig: CliConfig = {
      ...(savedConfig?.host !== undefined ? { host: savedConfig.host } : {}),
      ...(savedConfig?.port !== undefined && savedConfig.port > 0
        ? { port: savedConfig.port }
        : {}),
      ...(savedConfig?.stateDir !== undefined ? { stateDir: savedConfig.stateDir } : {}),
      ...(savedConfig?.password !== undefined ? { password: savedConfig.password } : {}),
      ...(args.host !== undefined ? { host: args.host } : {}),
      ...(args.port !== undefined ? { port: args.port } : {}),
      ...(args.stateDir !== undefined ? { stateDir: args.stateDir } : {}),
      ...(args.password !== undefined ? { password: args.password } : {}),
    };
    writeCliConfig(nextConfig);
    console.log(formatConfig(nextConfig));
    return;
  }

  if (args.command === "stop") {
    const stopped = await stopRunningServer();
    console.log(stopped ? "Stopped Coder Studio server." : "No running Coder Studio server found.");
    return;
  }

  if (args.command === "status") {
    console.log(formatStatus(await getServerStatus()));
    return;
  }

  if (args.command === "logs") {
    showLogs(await getServerStatus(), { tail: args.tail, errorsOnly: args.errorsOnly });
    return;
  }

  if (args.command === "help") {
    showHelp(commandName);
    return;
  }

  if (args.command === "version") {
    showVersion();
    return;
  }

  if (args.command === "identify") {
    printIdentify({ json: args.json });
    return;
  }

  if (args.command === "capabilities") {
    printCapabilities({ json: args.json });
    return;
  }

  if (args.command === "workspace" && args.workspaceCommand === "list") {
    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "workspace.list",
        args: {},
      }),
      { json: args.json }
    );
    return;
  }

  if (args.command === "session" && args.sessionCommand === "list") {
    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "session.list",
        args: { workspaceId: args.workspaceId! },
      }),
      { json: args.json }
    );
    return;
  }

  if (args.command === "terminal" && args.terminalCommand === "read") {
    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "terminal.read",
        args: {
          terminalId: args.terminalId!,
          ...(args.bytes !== undefined ? { bytes: args.bytes } : {}),
        },
      }),
      { json: args.json }
    );
    return;
  }

  if (args.command === "git" && args.gitCommand === "status") {
    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "git.status",
        args: { workspaceId: args.workspaceId! },
      }),
      { json: args.json }
    );
    return;
  }

  if (args.command === "git" && args.gitCommand === "diff") {
    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "git.diff",
        args: {
          workspaceId: args.workspaceId!,
          ...(args.path !== undefined ? { path: args.path } : {}),
          ...(args.staged === true ? { staged: true } : {}),
        },
      }),
      { json: args.json }
    );
    return;
  }

  if (args.command === "ui") {
    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "uiAction.dispatch",
        args: {
          ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
          intent: buildUiActionIntent(args),
          source: { kind: "agent" },
        },
      }),
      { json: args.json }
    );
    return;
  }

  if (args.command === "canvas") {
    if (args.canvasCommand === "list") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "canvas.list",
          args: { workspaceId: args.workspaceId! },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.canvasCommand === "create") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "canvas.create",
          args: {
            workspaceId: args.workspaceId!,
            kind: args.kind!,
            title: args.title!,
            document: parseJsonOption("document-json", args.documentJson!),
            ...(args.openInEditor === true ? { openInEditor: true } : {}),
          },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.canvasCommand === "update") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "canvas.update",
          args: {
            workspaceId: args.workspaceId!,
            canvasId: args.canvasId!,
            ...(args.title !== undefined ? { title: args.title } : {}),
            document: parseJsonOption("document-json", args.documentJson!),
          },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.canvasCommand === "render") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "canvas.render",
          args: {
            workspaceId: args.workspaceId!,
            ...(args.canvasId !== undefined ? { canvasId: args.canvasId } : {}),
            ...(args.sourcePath !== undefined ? { sourcePath: args.sourcePath } : {}),
          },
        }),
        { json: args.json }
      );
      return;
    }
  }

  if (args.command === "memory") {
    const workspaceId = resolveMemoryWorkspaceId(args);

    if (args.memoryCommand === "list") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "memory.list",
          args: {
            workspaceId,
            ...(args.query !== undefined ? { query: args.query } : {}),
            ...(args.memoryType !== undefined ? { type: args.memoryType } : {}),
          },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.memoryCommand === "search") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "memory.search",
          args: {
            workspaceId,
            query: args.query!,
            ...(args.memoryType !== undefined ? { type: args.memoryType } : {}),
          },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.memoryCommand === "get") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "memory.get",
          args: { workspaceId, id: args.memoryId! },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.memoryCommand === "add") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "memory.create",
          args: {
            workspaceId,
            type: args.memoryType!,
            content: args.content!,
            ...(args.memoryStatus !== undefined ? { status: args.memoryStatus } : {}),
            ...(args.skillSlug !== undefined ? { sourceHint: { skillSlug: args.skillSlug } } : {}),
          },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.memoryCommand === "update") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "memory.update",
          args: {
            workspaceId,
            id: args.memoryId!,
            ...(args.memoryType !== undefined ? { type: args.memoryType } : {}),
            ...(args.content !== undefined ? { content: args.content } : {}),
            ...(args.memoryStatus !== undefined ? { status: args.memoryStatus } : {}),
          },
        }),
        { json: args.json }
      );
      return;
    }

    if (args.memoryCommand === "delete") {
      printCommandResult(
        await callCoderStudioCommand({
          apiUrl: args.apiUrl,
          op: "memory.delete",
          args: { workspaceId, id: args.memoryId! },
        }),
        { json: args.json }
      );
      return;
    }
  }

  if (args.command === "auth") {
    if (args.authCommand === "ban-list") {
      console.log(formatAuthBlocks(await listAuthBlocks()));
      return;
    }

    if (args.authCommand === "unblock") {
      const cleared = await clearAuthBlockByIp(args.ip!);
      console.log(cleared ? `Unblocked IP: ${args.ip}` : `No block found for IP: ${args.ip}`);
      return;
    }
  }

  if (args.command === "open") {
    const startup = await prepareManagedStartup(args.restart);
    if (startup.existingStatus === null) {
      prepareLocalStateStorage();
      await startManagedServerFlow();
    }

    await openManagedServerInBrowser(startup.existingStatus);
    return;
  }

  if (args.foreground) {
    const startup = await prepareManagedStartup(args.restart);
    if (startup.existingStatus !== null) {
      return;
    }

    if (startup.restartRequested) {
      await stopRunningServer();
    }

    console.log("Starting Coder Studio Server in foreground...");
    await startServer();
    return;
  }

  const startup = await prepareManagedStartup(args.restart);
  if (startup.existingStatus !== null) {
    return;
  }

  prepareLocalStateStorage();
  await startManagedServerFlow();

  console.log("Coder Studio server started in background.");
  console.log(`Run \`${PRIMARY_CLI_COMMAND} status\` to inspect the server.`);
}
