/**
 * PTY Host Implementation
 *
 * Concrete implementation of PtyHost using node-pty
 */

import type { PtyHost, PtyProcess, PtySpawnOptions } from './types.js';

/**
 * Real PTY host using node-pty
 * Note: node-pty is loaded lazily to avoid native module loading errors during startup
 */
export class NodePtyHost implements PtyHost {
  spawn(argv: string[], options: PtySpawnOptions): PtyProcess {
    // Lazy load node-pty to avoid startup errors
    let pty: any;
    try {
      pty = require('node-pty');
    } catch (err) {
      throw new Error('node-pty native module not available. Terminal features require node-pty to be properly compiled.');
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
        ptyProcess.kill(signal);
      },
    };
  }
}
