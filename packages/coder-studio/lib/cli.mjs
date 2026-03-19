import fs from 'node:fs/promises';
import { DEFAULT_HOST, DEFAULT_PORT, resolveLogPath, resolveStateDir } from './config.mjs';
import { sleep } from './process-utils.mjs';
import { doctorRuntime, getStatus, openRuntime, readRuntimeLogs, restartRuntime, startRuntime, stopRuntime } from './runtime-controller.mjs';
import { readPackageVersion } from './state.mjs';

function parseArgv(argv) {
  const args = [...argv];
  const command = args.shift() || 'help';
  const flags = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--foreground') flags.foreground = true;
    else if (token === '--json') flags.json = true;
    else if (token === '--force') flags.force = true;
    else if (token === '--follow' || token === '-f') flags.follow = true;
    else if (token === '--help' || token === '-h') flags.help = true;
    else if (token === '--host') flags.host = args[++index];
    else if (token === '--port') flags.port = Number(args[++index]);
    else if (token === '--lines' || token === '-n') flags.lines = Number(args[++index]);
    else positionals.push(token);
  }

  return { command, flags, positionals };
}

function baseOptions(flags) {
  return {
    host: flags.host || DEFAULT_HOST,
    port: Number.isFinite(flags.port) ? flags.port : DEFAULT_PORT,
    foreground: Boolean(flags.foreground)
  };
}

function printHelp() {
  console.log(`Coder Studio CLI

Usage:
  coder-studio start [--host 127.0.0.1] [--port 41033] [--foreground]
  coder-studio stop
  coder-studio restart
  coder-studio status [--json]
  coder-studio logs [-f] [-n 120]
  coder-studio open
  coder-studio doctor [--json]
  coder-studio --version
`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printStatus(status) {
  console.log(`status: ${status.status}`);
  console.log(`managed: ${status.managed ? 'yes' : 'no'}`);
  console.log(`endpoint: ${status.endpoint}`);
  console.log(`pid: ${status.pid ?? 'n/a'}`);
  console.log(`stateDir: ${status.stateDir}`);
  console.log(`logPath: ${status.logPath}`);
  if (status.health?.version) {
    console.log(`version: ${status.health.version}`);
  }
  if (status.error) {
    console.log(`error: ${status.error}`);
  }
  if (status.stale) {
    console.log('note: stale runtime state was cleaned up');
  }
}

async function printDoctor(report, asJson) {
  if (asJson) {
    printJson(report);
    return;
  }

  console.log('doctor:');
  console.log(`status: ${report.status.status}`);
  console.log(`endpoint: ${report.status.endpoint}`);
  console.log(`stateDir: ${report.stateDir}`);
  console.log(`dataDir: ${report.dataDir}`);
  console.log(`logPath: ${report.logPath}`);
  console.log(`logExists: ${report.logExists ? 'yes' : 'no'}`);
  if (report.bundle?.error) {
    console.log(`bundleError: ${report.bundle.error}`);
  } else {
    console.log(`runtimePackage: ${report.bundle.packageName}`);
    console.log(`binaryPath: ${report.bundle.binaryPath}`);
    console.log(`distDir: ${report.bundle.distDir}`);
  }
  if (report.runtime?.startedAt) {
    console.log(`startedAt: ${report.runtime.startedAt}`);
  }
  if (report.status.error) {
    console.log(`error: ${report.status.error}`);
  }
}

async function followLogs(logPath, initialLines = 80) {
  const initial = await readRuntimeLogs({ logPath, lines: initialLines });
  if (initial) {
    process.stdout.write(`${initial}\n`);
  }

  let cursor = 0;
  try {
    const stat = await fs.stat(logPath);
    cursor = stat.size;
  } catch {
    cursor = 0;
  }

  let active = true;
  const stop = () => {
    active = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    while (active) {
      try {
        const stat = await fs.stat(logPath);
        if (stat.size < cursor) {
          cursor = 0;
        }
        if (stat.size > cursor) {
          const handle = await fs.open(logPath, 'r');
          const chunk = Buffer.alloc(stat.size - cursor);
          await handle.read(chunk, 0, chunk.length, cursor);
          await handle.close();
          cursor = stat.size;
          process.stdout.write(chunk.toString('utf8'));
        }
      } catch {
        // Ignore missing log between restarts.
      }
      await sleep(400);
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgv(argv);

  if (command === '--version' || command === '-v' || flags.version) {
    console.log(await readPackageVersion());
    return 0;
  }

  if (command === 'help' || flags.help) {
    printHelp();
    return 0;
  }

  const options = baseOptions(flags);

  if (command === 'start') {
    const result = await startRuntime({
      ...options,
      foreground: Boolean(flags.foreground),
      onReady: async ({ endpoint, pid }) => {
        if (!flags.json) {
          console.log(`coder-studio started`);
          console.log(`endpoint: ${endpoint}`);
          console.log(`pid: ${pid}`);
        }
      }
    });

    if (flags.json) {
      printJson(result);
    } else if (!flags.foreground) {
      console.log(result.changed ? 'runtime is ready' : 'runtime already running');
      console.log(`endpoint: ${result.endpoint}`);
      console.log(`pid: ${result.pid ?? 'n/a'}`);
      console.log(`logPath: ${result.logPath || resolveLogPath(resolveStateDir())}`);
    }
    return result.status === 'failed' ? 1 : 0;
  }

  if (command === 'stop') {
    const result = await stopRuntime(options);
    if (flags.json) printJson(result);
    else console.log(result.changed ? 'coder-studio stopped' : 'coder-studio already stopped');
    return 0;
  }

  if (command === 'restart') {
    const result = await restartRuntime(options);
    if (flags.json) printJson(result);
    else {
      console.log('coder-studio restarted');
      console.log(`endpoint: ${result.endpoint}`);
      console.log(`pid: ${result.pid ?? 'n/a'}`);
    }
    return 0;
  }

  if (command === 'status') {
    const status = await getStatus(options);
    if (flags.json) printJson(status);
    else printStatus(status);
    return status.status === 'stopped' ? 1 : 0;
  }

  if (command === 'logs') {
    const stateDir = resolveStateDir();
    const logPath = resolveLogPath(stateDir);
    if (flags.follow) {
      await followLogs(logPath, Number.isFinite(flags.lines) ? flags.lines : 80);
      return 0;
    }
    const output = await readRuntimeLogs({ logPath, lines: Number.isFinite(flags.lines) ? flags.lines : 80 });
    if (output) console.log(output);
    return 0;
  }

  if (command === 'open') {
    const result = await openRuntime(options);
    if (flags.json) printJson(result);
    else console.log(`opened: ${result.endpoint}`);
    return 0;
  }

  if (command === 'doctor') {
    const report = await doctorRuntime(options);
    await printDoctor(report, Boolean(flags.json));
    return report.status.status === 'running' || report.status.status === 'degraded' ? 0 : 1;
  }

  printHelp();
  return 1;
}
