/**
 * PTY Host Implementation
 *
 * Concrete implementation of PtyHost using node-pty
 */

import { createRequire } from 'node:module';
import type { PtyHost, PtyProcess, PtySpawnOptions } from './types.js';

const require = createRequire(import.meta.url);

/**
 * Options for kill escalation polling
 */
export interface KillEscalationOptions {
  /** Poll interval in milliseconds */
  pollIntervalMs?: number;
  /** Maximum time to wait before escalating to SIGKILL */
  timeoutMs?: number;
}

/** Default polling interval */
const DEFAULT_POLL_INTERVAL_MS = 50;

/** Default timeout before SIGKILL escalation */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Send signal to process and all its children (process group)
 *
 * @param pid - Process ID (will use -pid for process group)
 * @param signal - Signal to send
 * @returns true if signal was sent successfully, false otherwise
 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
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
 * Check if a process group or process is still alive
 *
 * Mirrors the same group-first, pid-fallback semantics used when sending signals.
 *
 * @param pid - Process ID (will use -pid for process group first)
 * @returns true if the process group or process exists, false otherwise
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Escalate from SIGTERM to SIGKILL with polling
 *
 * This function sends SIGTERM, then polls to check if the process
 * has exited. If it hasn't exited within the timeout window, SIGKILL
 * is sent.
 *
 * @param pid - Process ID
 * @param signal - Initial signal to send
 * @param options - Polling options
 * @returns Promise resolving to true if any signal was sent, false if initial signal failed
 */
export async function escalateKillWithPolling(
  pid: number,
  signal: NodeJS.Signals,
  options?: KillEscalationOptions
): Promise<boolean> {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // For non-SIGTERM signals, just send directly without polling
  if (signal !== 'SIGTERM') {
    return killProcessGroup(pid, signal);
  }

  // Send SIGTERM
  const sent = killProcessGroup(pid, 'SIGTERM');
  if (!sent) {
    return false;
  }

  // Check immediately if process already exited
  if (!isProcessAlive(pid)) {
    return true;
  }

  // Poll until timeout
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    // Wait for next poll interval
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    // Check if process group has exited
    if (!isProcessAlive(pid)) {
      return true;
    }
  }

  // Process survived timeout, escalate to SIGKILL
  killProcessGroup(pid, 'SIGKILL');
  return true;
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
        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => callback({ exitCode }));
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
      kill: (signal: NodeJS.Signals = 'SIGTERM') => {
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
          escalateKillWithPolling(pid, signal).catch(() => {
            // Silently ignore errors from escalation polling
          });
        }
      },
    };
  }
}
