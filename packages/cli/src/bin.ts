import { createServer } from '@coder-studio/server';
import type { ServerConfig } from '@coder-studio/server';
import { getStaticAssetsDir, hasWebAssets } from './embed.js';
import { parseArgs } from './parse-args.js';
import { readCliConfig, writeCliConfig, type CliConfig } from './config-store.js';
import { ensureSingleServer, stopRunningServer } from './server-control.js';

function formatConfig(config: CliConfig | null): string {
  return JSON.stringify(config ?? {}, null, 2);
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
@coder-studio/cli - Coder Studio CLI

USAGE:
  coder-studio [COMMAND] [OPTIONS]

COMMANDS:
  serve    Start the Coder Studio server (default)
  config   Persist CLI host/port settings
  stop     Stop the running Coder Studio server
  help     Show this help message
  version  Show version

OPTIONS:
  --host <string>          Server host for config command
  --port, -p <number>      Server port for config command
  --data-dir, -d <path>   Data directory for storage
  --password <string>     Enable auth with password
  --no-auth               Disable auth explicitly
  --help                  Show help
  --version, -v           Show version

EXAMPLES:
  coder-studio serve
  coder-studio config --host 0.0.0.0 --port 8080
  coder-studio stop
  coder-studio --help
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

OPTIONS:
  --host <string>          Save server host
  --port, -p <number>      Save server port
  --data-dir, -d <path>    Save data directory
  --password <string>      Save auth password
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

/**
 * Show version
 */
function showVersion(): void {
  const version = '0.0.1';
  console.log(`@coder-studio/cli v${version}`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'config') {
    if (args.configHelp) {
      showConfigHelp();
      process.exit(0);
    }

    if (
      args.host === undefined &&
      args.port === undefined &&
      args.dataDir === undefined &&
      args.password === undefined
    ) {
      console.log(formatConfig(readCliConfig()));
      process.exit(0);
    }

    const nextConfig: CliConfig = {
      ...(readCliConfig() ?? {}),
      ...(args.host !== undefined ? { host: args.host } : {}),
      ...(args.port !== undefined ? { port: args.port } : {}),
      ...(args.dataDir !== undefined ? { dataDir: args.dataDir } : {}),
      ...(args.password !== undefined ? { password: args.password } : {}),
    };
    writeCliConfig(nextConfig);
    console.log(formatConfig(nextConfig));
    process.exit(0);
  }

  if (args.command === 'stop') {
    const stopped = await stopRunningServer();
    console.log(stopped ? 'Stopped Coder Studio server.' : 'No running Coder Studio server found.');
    process.exit(0);
  }

  if (args.command === 'help') {
    showHelp();
    process.exit(0);
  }

  if (args.command === 'version') {
    showVersion();
    process.exit(0);
  }

  console.log('Starting Coder Studio Server...\n');

  await ensureSingleServer();

  const savedConfig = readCliConfig();
  const config: Partial<ServerConfig> = {};

  if (savedConfig?.port !== undefined) {
    config.port = savedConfig.port;
  }

  if (savedConfig?.host !== undefined) {
    config.host = savedConfig.host;
  }

  if (savedConfig?.dataDir !== undefined) {
    config.dataDir = savedConfig.dataDir;
  }

  const password = args.password ?? savedConfig?.password;
  const authEnabled = args.noAuth ? false : password !== undefined;

  if (args.dataDir !== undefined) {
    config.dataDir = args.dataDir;
  }

  if (password !== undefined || args.noAuth !== undefined) {
    config.auth = {
      enabled: authEnabled,
      password,
    };
  }

  if (hasWebAssets()) {
    config.webRoot = getStaticAssetsDir();
  } else {
    console.warn('Warning: Web assets not found. Frontend will not be available.');
  }

  const server = await createServer(config);

  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('CLI error:', err.message);
  process.exit(1);
});
