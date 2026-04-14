/**
 * Development script for server package
 * Starts tsx watch for backend
 */

import { runBackground } from './shared/process.js';
import { SERVER_DIR, log, info, success, error } from './shared/index.js';
import { resolve } from 'path';

const SERVER_PORT = 4173;
const SERVER_HOST = '127.0.0.1';

async function devServer(): Promise<void> {
  info('Starting tsx watch for backend...');

  const serverProcess = runBackground('pnpm', ['tsx', 'watch', 'src/index.ts'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: SERVER_HOST,
      PORT: String(SERVER_PORT),
    },
  });

  serverProcess.on('error', (err) => {
    error(`Server process failed: ${err.message}`);
    process.exit(1);
  });

  success(`Backend dev server running at http://${SERVER_HOST}:${SERVER_PORT}`);

  // Handle process termination
  process.on('SIGINT', () => {
    info('\nStopping backend dev server...');
    serverProcess.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    serverProcess.kill('SIGTERM');
    process.exit(0);
  });
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  devServer().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}

export { devServer };