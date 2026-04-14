/**
 * PTY Host Implementation
 *
 * Concrete implementation of PtyHost using node-pty
 */

import * as pty from 'node-pty';
import type { PtyHost, PtyProcess, PtySpawnOptions } from './types.js';

/**
 * Real PTY host using node-pty
 */
export class NodePtyHost implements PtyHost {
  spawn(argv: string[], options: PtySpawnOptions): PtyProcess {
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
