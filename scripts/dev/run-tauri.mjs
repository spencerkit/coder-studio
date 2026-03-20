import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TAURI_CLI = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const CONFIG_PATH = path.join(ROOT, 'apps', 'server', 'tauri.conf.json');
const CONFIG_COMMANDS = new Set(['dev', 'build', 'bundle']);

const args = process.argv.slice(2);
const hasExplicitConfig = args.includes('-c') || args.includes('--config');
const firstArg = args[0];
const shouldInjectConfig = Boolean(firstArg)
  && CONFIG_COMMANDS.has(firstArg)
  && !hasExplicitConfig;

const childArgs = shouldInjectConfig
  ? [TAURI_CLI, firstArg, '-c', CONFIG_PATH, ...args.slice(1)]
  : [TAURI_CLI, ...args];

const child = spawn(process.execPath, childArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
