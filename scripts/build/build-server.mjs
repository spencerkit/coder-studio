import { spawn } from 'node:child_process';
import { ROOT } from '../lib/package-matrix.mjs';
import {
  buildServerCargoArgs,
  resolveRustTarget,
  resolveServerBinaryPath,
} from '../lib/server-build.mjs';

const cliArgs = process.argv.slice(2);
const targetIndex = cliArgs.indexOf('--target');

if (targetIndex !== -1) {
  const target = cliArgs[targetIndex + 1];
  if (!target) {
    throw new Error('missing value for --target');
  }
  process.env.CODER_STUDIO_RUST_TARGET = target;
  cliArgs.splice(targetIndex, 2);
}

if (cliArgs.length > 0) {
  throw new Error(`unsupported arguments: ${cliArgs.join(' ')}`);
}

const cargoArgs = buildServerCargoArgs({ env: process.env });
await new Promise((resolve, reject) => {
  const child = spawn('cargo', cargoArgs, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (signal) {
      reject(new Error(`cargo build terminated by signal ${signal}`));
      return;
    }
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`cargo build failed with exit code ${code ?? 'unknown'}`));
  });
});

const rustTarget = resolveRustTarget({ env: process.env });
console.log(`built coder-studio server${rustTarget ? ` (${rustTarget})` : ''}`);
console.log(`binary: ${resolveServerBinaryPath({ env: process.env })}`);
