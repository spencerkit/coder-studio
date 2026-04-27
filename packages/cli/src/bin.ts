import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './parse-args.js';
import { readCliConfig, writeCliConfig, type CliConfig } from './config-store.js';
import { startManagedServer } from './pm2-control.js';
import { getServerStatus, stopRunningServer, type ServerStatus } from './server-control.js';
import { startServer } from './server-runner.js';

const MANAGED_SERVER_WAIT_MS = 5000;

function formatConfig(config: CliConfig | null): string {
  return JSON.stringify(config ?? {}, null, 2);
}

function formatStatus(status: ServerStatus): string {
  const url = status.port === null ? 'n/a' : `http://127.0.0.1:${status.port}`;
  const startedAt = status.startedAt === null ? 'n/a' : new Date(status.startedAt).toISOString();

  return [
    `Status: ${status.status}`,
    `URL: ${url}`,
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
@coder-studio/cli - Coder Studio CLI

USAGE:
  coder-studio [COMMAND]

COMMANDS:
  serve    Start the Coder Studio server in background (default)
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
  --help                   Show help
  --version, -v            Show version

EXAMPLES:
  coder-studio
  coder-studio serve
  coder-studio serve --foreground
  coder-studio status
  coder-studio logs
  coder-studio stop
  coder-studio config --host 0.0.0.0 --port 8080
`);
}

function showConfigHelp(): void {
  console.log(`
@coder-studio/cli - config

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
  console.log(`@coder-studio/cli v${version}`);
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

export async function main(argv = process.argv.slice(2)): Promise<void> {
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

  if (args.foreground) {
    console.log('Starting Coder Studio Server in foreground...');
    await startServer();
    return;
  }

  await startManagedServer({
    script: resolveManagedScriptPath(),
    cwd: process.cwd(),
    waitMs: MANAGED_SERVER_WAIT_MS,
  });

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
