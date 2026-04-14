/**
 * CLI Entry Point
 *
 * Parses command-line arguments and starts the server
 */

import { createServer } from '@coder-studio/server';
import type { ServerConfig } from '@coder-studio/server';
import { getStaticAssetsDir, hasWebAssets } from './embed.js';

interface CliArgs {
  command?: 'serve' | 'help' | 'version';
  port?: number;
  host?: string;
  dataDir?: string;
}

/**
 * Parse command-line arguments
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case 'serve':
        args.command = 'serve';
        break;

      case '--port':
      case '-p':
        args.port = parseInt(argv[++i], 10);
        if (isNaN(args.port)) {
          throw new Error('Invalid port number');
        }
        break;

      case '--host':
      case '-h':
        args.host = argv[++i];
        break;

      case '--data-dir':
      case '-d':
        args.dataDir = argv[++i];
        break;

      case '--help':
        args.command = 'help';
        break;

      case '--version':
      case '-v':
        args.command = 'version';
        break;
    }
  }

  return args;
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
  help     Show this help message
  version  Show version

OPTIONS:
  --port, -p <number>     Server port (default: 4173)
  --host, -h <string>     Server host (default: 127.0.0.1)
  --data-dir, -d <path>   Data directory for storage
  --help                  Show help
  --version, -v           Show version

EXAMPLES:
  coder-studio serve
  coder-studio serve --port 3000
  coder-studio serve --host 0.0.0.0 --port 8080
  coder-studio --help
`);
}

/**
 * Show version
 */
function showVersion(): void {
  // Read version from package.json
  const version = '0.0.1'; // Will be replaced during build
  console.log(`@coder-studio/cli v${version}`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Handle help/version
  if (args.command === 'help') {
    showHelp();
    process.exit(0);
  }

  if (args.command === 'version') {
    showVersion();
    process.exit(0);
  }

  // Default: serve
  console.log('Starting Coder Studio Server...\n');

  // Prepare server config
  const config: Partial<ServerConfig> = {};

  if (args.port !== undefined) {
    config.port = args.port;
  }

  if (args.host !== undefined) {
    config.host = args.host;
  }

  if (args.dataDir !== undefined) {
    config.dataDir = args.dataDir;
  }

  // Set web root for serving frontend assets
  if (hasWebAssets()) {
    config.webRoot = getStaticAssetsDir();
  } else {
    console.warn('Warning: Web assets not found. Frontend will not be available.');
  }

  // Create and start server
  const server = await createServer(config);

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run CLI
main().catch((err) => {
  console.error('CLI error:', err.message);
  process.exit(1);
});
