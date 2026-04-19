/**
 * PTY Host Implementation
 *
 * Concrete implementation of PtyHost using node-pty
 */

import { createRequire } from 'node:module';
import type { PtyHost, PtyProcess, PtySpawnOptions } from './types.js';

const require = createRequire(import.meta.url);

/**
 * Send signal to process and all its children (process group)
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    // Negative PID means kill the process group
    // This ensures all child processes are terminated as well
    process.kill(-pid, signal);
    return true;
  } catch {
    // Fallback to regular kill if process group doesn't exist
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Real PTY host using node-pty
 * Note: node-pty is loaded lazily to avoid native module loading errors during startup
 */
export class NodePtyHost implements PtyHost {
  spawn(argv: string[], options: PtySpawnOptions): PtyProcess {
    // Lazy load node-pty to avoid native module loading errors
    let pty: any;
    try {
      pty = require('node-pty');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`node-pty native module not available. ${message}`);
    }

    const [command, ...args] = argv;

    const ptyProcess = pty.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
    });

    return {
      onData: (callback) => {
        ptyProcess.onData(callback);
      },
      onExit: (callback) => {
        ptyProcess.onExit(({ exitCode }) => callback({ exitCode }));
      },
      write: (data) => {
        if (Buffer.isBuffer(data)) {
          ptyProcess.write(data.toString('utf-8'));
        } else {
          ptyProcess.write(data);
        }
      },
      resize: (cols, rows) => {
        ptyProcess.resize(cols, rows);
      },
      kill: (signal) => {
        const pid = ptyProcess.pid;

        if (pid > 0) {
          // First try node-pty's built-in kill
          try {
            ptyProcess.kill(signal);
          } catch {
            // Ignore errors from ptyProcess.kill
          }

          // Also send to process group to ensure child processes are terminated
          // This handles cases where shell spawns child processes
          if (signal === 'SIGTERM') {
            // Give process a moment to handle SIGTERM, then SIGKILL if still alive
            const killed = killProcessGroup(pid, 'SIGTERM');
            if (!killed) return;

            setTimeout(() => {
              try {
                process.kill(-pid, 0); // Check if process group still exists
                killProcessGroup(pid, 'SIGKILL');
              } catch {
                // Process already terminated
              }
            }, 100);
          } else {
            killProcessGroup(pid, signal);
          }
        }
      },
    };
  }
}
