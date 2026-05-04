import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './parse-args.js';
import { clearAuthBlockByIp, listAuthBlocks } from './auth-control.js';
import { readCliConfig, writeCliConfig, type CliConfig } from './config-store.js';
import { startManagedServer } from './pm2-control.js';
import { getServerStatus, stopRunningServer, type ServerStatus } from './server-control.js';
import { startServer } from './server-runner.js';
import { openBrowser } from './browser.js';
import { confirmYesNo, isInteractiveSession } from './prompts.js';
import { getBrowserUrl, getListenIp, getListenUrl } from './server-url.js';
import { assertSupportedNodeVersion } from './node-version.js';

const MANAGED_SERVER_WAIT_MS = 5000;

function formatConfig(config: CliConfig | null): string {
  return JSON.stringify(config ?? {}, null, 2);
}

function formatStatus(status: ServerStatus): string {
  const listenUrl = getListenUrl(status) ?? 'n/a';
  const browserUrl = getBrowserUrl(status) ?? 'n/a';
  const startedAt = status.startedAt === null ? 'n/a' : new Date(status.startedAt).toISOString();

  return [
    `Status: ${status.status}`,
    `Listen host: ${status.host ?? 'n/a'}`,
    `Listen IP: ${getListenIp(status) ?? 'n/a'}`,
    `Port: ${status.port ?? 'n/a'}`,
    `Listen URL: ${listenUrl}`,
    `Local URL: ${browserUrl}`,
    `PID: ${status.pid ?? 'n/a'}`,
    `Started: ${startedAt}`,
    `Restarts: ${status.restartCount}`,
    `Out log: ${status.outFile}`,
    `Error log: ${status.errFile}`,
  ].join('\n');
}

function showLogs(status: ServerStatus): void {
  const contents = [status.outFile, status.errFile]
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .flatMap((path) => {
      if (!existsSync(path)) {
        return [];
      }

      const content = readFileSync(path, 'utf-8').trim();
      return content ? [content] : [];
    });

  console.log(contents.length === 0 ? 'No logs available.' : contents.join('\n'));
}

function showHelp(): void {
  console.log(`
@spencer-kit/coder-studio - Coder Studio CLI

USAGE:
  coder-studio [COMMAND]

COMMANDS:
  serve    Start the Coder Studio server in background (default)
  server   Alias for serve
  open     Start the server if needed and open Coder Studio in a browser
  auth     Manage auth login blocks in local server storage
  config   Persist CLI host/port/data-dir/password settings
  stop     Stop the managed Coder Studio server
  status   Show the managed server status
  logs     Show the managed server logs
  help     Show this help message
  version  Show version

OPTIONS:
  --host <string>          Save server host for future runs
  --port, -p <number>      Save server port for future runs
  --data-dir, -d <path>    Save data directory for future runs
  --password <string>      Save auth password for future runs
  --restart                Restart an already running managed server for serve/open
  --help                   Show help
  --version, -v            Show version

EXAMPLES:
  coder-studio
  coder-studio serve
  coder-studio server
  coder-studio auth ban-list
  coder-studio auth unblock --ip 198.51.100.24
  coder-studio serve --foreground
  coder-studio serve --restart
  coder-studio open
  coder-studio open --restart
  coder-studio status
  coder-studio logs
  coder-studio stop
  coder-studio config --host 0.0.0.0 --port 8080
`);
}

function showConfigHelp(): void {
  console.log(`
@spencer-kit/coder-studio - config

USAGE:
  coder-studio config [OPTIONS]
  coder-studio config help

BEHAVIOR:
  Without options, prints the current saved config.
  Bare serve reads this saved config for future runs.

OPTIONS:
  --host <string>          Save server host for future runs
  --port, -p <number>      Save server port for future runs
  --data-dir, -d <path>    Save data directory for future runs
  --password <string>      Save auth password for future runs
  --help                   Show config help

EXAMPLES:
  coder-studio config
  coder-studio config --host 0.0.0.0
  coder-studio config --port 8080
  coder-studio config --data-dir /tmp/cs-data
  coder-studio config --password sekrit
  coder-studio config --host 0.0.0.0 --port 8080
`);
}

function showVersion(): void {
  const version = '0.0.1';
  console.log(`@spencer-kit/coder-studio v${version}`);
}

function formatAuthBlocks(blocks: Awaited<ReturnType<typeof listAuthBlocks>>): string {
  if (blocks.length === 0) {
    return 'No blocked IPs.';
  }

  return JSON.stringify(blocks, null, 2);
}

function resolveManagedScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, 'server-runner.js'),
    join(currentDir, 'server-runner.mjs'),
    join(currentDir, '../src/server-runner.ts'),
  ];

  const scriptPath = candidates.find((candidate) => existsSync(candidate));
  if (!scriptPath) {
    throw new Error('Unable to locate the managed server entry script');
  }

  return scriptPath;
}

function isCliEntrypoint(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const entryScript = resolve(process.argv[1]);
  const entryCandidates = new Set([
    currentFile,
    join(currentDir, '../bin.js'),
    join(currentDir, '../dist/bin.js'),
  ]);

  return entryCandidates.has(entryScript);
}

function isRunningStatus(status: ServerStatus): boolean {
  return status.status === 'running' || status.status === 'starting';
}

interface ManagedStartupDecision {
  existingStatus: ServerStatus | null;
  restartRequested: boolean;
}

async function shouldRestartRunningServer(status: ServerStatus): Promise<boolean> {
  const currentUrl = getBrowserUrl(status) ?? getListenUrl(status) ?? 'the existing server';

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
    const currentUrl = getBrowserUrl(status) ?? getListenUrl(status) ?? 'n/a';
    if (!isInteractiveSession()) {
      console.log(`Coder Studio is already running at ${currentUrl}. Service already exists and was not restarted.`);
    } else {
      console.log(`Leaving the existing Coder Studio server running at ${currentUrl}.`);
    }
    return {
      existingStatus: status,
      restartRequested: false,
    };
  }

  console.log('Restarting the managed Coder Studio server...');
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
    throw new Error('Unable to determine the running Coder Studio URL.');
  }

  console.log(`Opening Coder Studio in your browser: ${browserUrl}`);
  await openBrowser(browserUrl);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  assertSupportedNodeVersion();
  const args = parseArgs(argv);

  if (args.command === 'config') {
    if (args.configHelp) {
      showConfigHelp();
      return;
    }

    if (
      args.host === undefined &&
      args.port === undefined &&
      args.dataDir === undefined &&
      args.password === undefined
    ) {
      console.log(formatConfig(readCliConfig()));
      return;
    }

    const savedConfig = readCliConfig();
    const nextConfig: CliConfig = {
      ...(savedConfig?.host !== undefined ? { host: savedConfig.host } : {}),
      ...(savedConfig?.port !== undefined && savedConfig.port > 0 ? { port: savedConfig.port } : {}),
      ...(savedConfig?.dataDir !== undefined ? { dataDir: savedConfig.dataDir } : {}),
      ...(savedConfig?.password !== undefined ? { password: savedConfig.password } : {}),
      ...(args.host !== undefined ? { host: args.host } : {}),
      ...(args.port !== undefined ? { port: args.port } : {}),
      ...(args.dataDir !== undefined ? { dataDir: args.dataDir } : {}),
      ...(args.password !== undefined ? { password: args.password } : {}),
    };
    writeCliConfig(nextConfig);
    console.log(formatConfig(nextConfig));
    return;
  }

  if (args.command === 'stop') {
    const stopped = await stopRunningServer();
    console.log(stopped ? 'Stopped Coder Studio server.' : 'No running Coder Studio server found.');
    return;
  }

  if (args.command === 'status') {
    console.log(formatStatus(await getServerStatus()));
    return;
  }

  if (args.command === 'logs') {
    showLogs(await getServerStatus());
    return;
  }

  if (args.command === 'help') {
    showHelp();
    return;
  }

  if (args.command === 'version') {
    showVersion();
    return;
  }

  if (args.command === 'auth') {
    if (args.authCommand === 'ban-list') {
      console.log(formatAuthBlocks(await listAuthBlocks()));
      return;
    }

    if (args.authCommand === 'unblock') {
      const cleared = await clearAuthBlockByIp(args.ip!);
      console.log(cleared ? `Unblocked IP: ${args.ip}` : `No block found for IP: ${args.ip}`);
      return;
    }
  }

  if (args.command === 'open') {
    const startup = await prepareManagedStartup(args.restart);
    if (startup.existingStatus === null) {
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

    console.log('Starting Coder Studio Server in foreground...');
    await startServer();
    return;
  }

  const startup = await prepareManagedStartup(args.restart);
  if (startup.existingStatus !== null) {
    return;
  }

  await startManagedServerFlow();

  console.log('Coder Studio server started in background.');
  console.log('Run `coder-studio status` to inspect the server.');
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('CLI error:', message);
    process.exit(1);
  });
}
