import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const CARGO_CMD = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    skipWslPreflight: false,
    wslDistro: null
  };

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--') {
      continue;
    }
    if (current === '--skip-wsl-preflight') {
      options.skipWslPreflight = true;
      continue;
    }
    if (current === '--wsl-distro') {
      const value = args.shift();
      if (!value) {
        throw new Error('missing value for --wsl-distro');
      }
      options.wslDistro = value;
      continue;
    }
    throw new Error(`unsupported argument: ${current}`);
  }

  return options;
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n[windows-transport-smoke] ${label}\n`);
    process.stdout.write(`[windows-transport-smoke] ${formatCommand(command, args)}\n`);

    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}`));
    });
  });
}

function buildWslPreflightArgs(distro) {
  const shellScript = [
    'set -eu',
    'command -v wslpath >/dev/null',
    'tmp_dir=$(mktemp -d)',
    'trap \'rm -rf "$tmp_dir"\' EXIT',
    'wslpath -w "$tmp_dir" >/dev/null'
  ].join('; ');

  const args = [];
  if (distro) {
    args.push('-d', distro);
  }
  args.push('--', '/bin/sh', '-lc', shellScript);
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (process.platform !== 'win32') {
    throw new Error('windows transport smoke only runs on a Windows host');
  }

  process.stdout.write('[windows-transport-smoke] starting Windows transport smoke\n');
  if (options.wslDistro) {
    process.stdout.write(`[windows-transport-smoke] using WSL distro: ${options.wslDistro}\n`);
  }
  if (options.skipWslPreflight) {
    process.stdout.write('[windows-transport-smoke] WSL preflight: skipped\n');
  } else {
    await run('wsl.exe', buildWslPreflightArgs(options.wslDistro), 'WSL preflight');
  }

  await run(
    CARGO_CMD,
    ['test', '--manifest-path', 'apps/server/Cargo.toml', 'parse_wsl_watch_path'],
    'WSL path parser test'
  );
  await run(
    CARGO_CMD,
    ['check', '--manifest-path', 'apps/server/Cargo.toml'],
    'native cargo check'
  );
  await run(
    CARGO_CMD,
    ['check', '--manifest-path', 'apps/server/Cargo.toml', '--target', 'x86_64-pc-windows-gnu'],
    'windows-gnu cargo check'
  );
  await run(PNPM_CMD, ['build:web'], 'web build');
  await run(
    PNPM_CMD,
    ['test:e2e', 'tests/e2e/transport.spec.ts'],
    'transport e2e smoke'
  );

  process.stdout.write('\n[windows-transport-smoke] smoke passed\n');
}

main().catch((error) => {
  process.stderr.write(`\n[windows-transport-smoke] ${error.message}\n`);
  process.exitCode = 1;
});
