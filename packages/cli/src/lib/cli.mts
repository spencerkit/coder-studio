// @ts-nocheck
import fs from 'node:fs/promises';
import path from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import {
  generateCompletionScript,
  installCompletionScript,
  uninstallCompletionScript,
  SUPPORTED_COMPLETION_SHELLS,
} from './completion.mjs';
import { resolveLogPath } from './config.mjs';
import {
  buildConfigPathsReport,
  flattenPublicConfig,
  getPublicConfigValue,
  isRuntimeConfigKey,
  listConfigKeys,
  loadLocalConfig,
  mergeRuntimeConfigView,
  normalizeConfigValue,
  updateLocalConfig,
  validateConfigSnapshot,
} from './user-config.mjs';
import { sleep } from './process-utils.mjs';
import {
  fetchAdminAuthStatus,
  fetchAdminConfig,
  fetchAdminIpBlocks,
  patchAdminConfig,
  unblockAdminIp,
} from './http.mjs';
import {
  doctorRuntime,
  getStatus,
  openRuntime,
  readRuntimeLogs,
  restartRuntime,
  startRuntime,
  stopRuntime,
} from './runtime-controller.mjs';
import { readPackageVersion } from './state.mjs';

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const RUNTIME_DB_FILENAME = 'coder-studio.db';

class CliError extends Error {
  constructor(message, { exitCode = EXIT_FAILURE, helpTopic = null } = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.helpTopic = helpTopic;
  }
}

function usageError(message, helpTopic = null) {
  return new CliError(message, { exitCode: EXIT_USAGE, helpTopic });
}

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
    else if (token === '--stdin') flags.stdin = true;
    else if (token === '--all') flags.all = true;
    else if (token === '--host') flags.host = args[++index];
    else if (token === '--port') flags.port = Number(args[++index]);
    else if (token === '--lines' || token === '-n') flags.lines = Number(args[++index]);
    else positionals.push(token);
  }

  return { command, flags, positionals };
}

async function resolveCommandContext(flags) {
  const config = await loadLocalConfig();
  const host = flags.host || config.values.server.host;
  const port = Number.isFinite(flags.port) ? flags.port : config.values.server.port;
  const options = {
    stateDir: config.paths.stateDir,
    dataDir: config.paths.dataDir,
    host,
    port,
    logPath: resolveLogPath(config.paths.stateDir),
    tailLines: config.values.logs.tailLines,
    openCommand: config.values.system.openCommand,
  };
  return { config, options };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Coder Studio CLI

Usage:
  coder-studio help [command]
  coder-studio start [--host 127.0.0.1] [--port 41033] [--foreground] [--json]
  coder-studio stop [--json]
  coder-studio restart [--json]
  coder-studio status [--json]
  coder-studio logs [-f] [-n 120]
  coder-studio open [--json]
  coder-studio doctor [--json]
  coder-studio config <subcommand>
  coder-studio auth <subcommand>
  coder-studio completion <bash|zsh|fish>
  coder-studio completion install <bash|zsh|fish> [--json] [--force]
  coder-studio completion uninstall <bash|zsh|fish> [--json]
  coder-studio --version

Global Flags:
  --json         machine-readable output
  --host <host>  override configured host for this invocation
  --port <port>  override configured port for this invocation
  -h, --help     show help

Exit Codes:
  0  success
  1  runtime or operation failure
  2  usage or argument error

Examples:
  coder-studio help start
  coder-studio help completion
  coder-studio start
  coder-studio config show --json
  coder-studio config root set /srv/coder-studio/workspaces
  coder-studio auth ip list
  eval "$(coder-studio completion bash)"
  coder-studio completion install bash
  coder-studio completion uninstall bash

Run \`coder-studio config --help\`, \`coder-studio auth --help\`, or \`coder-studio help completion\` for detailed usage.
`);
}

function printStartHelp() {
  console.log(`coder-studio start

Usage:
  coder-studio start [--host <host>] [--port <port>] [--foreground] [--json]

Options:
  --host <host>   override configured host for this invocation
  --port <port>   override configured port for this invocation
  --foreground    keep the runtime in the foreground
  --json          machine-readable output

Examples:
  coder-studio start
  coder-studio start --foreground
  coder-studio start --port 42033 --json
`);
}

function printStopHelp() {
  console.log(`coder-studio stop

Usage:
  coder-studio stop [--json]

Options:
  --json  machine-readable output

Examples:
  coder-studio stop
  coder-studio stop --json
`);
}

function printRestartHelp() {
  console.log(`coder-studio restart

Usage:
  coder-studio restart [--json]

Options:
  --json  machine-readable output

Examples:
  coder-studio restart
  coder-studio restart --json
`);
}

function printStatusHelp() {
  console.log(`coder-studio status

Usage:
  coder-studio status [--host <host>] [--port <port>] [--json]

Options:
  --host <host>  override configured host for this invocation
  --port <port>  override configured port for this invocation
  --json         machine-readable output

Examples:
  coder-studio status
  coder-studio status --json
`);
}

function printLogsHelp() {
  console.log(`coder-studio logs

Usage:
  coder-studio logs [-f] [-n <lines>]

Options:
  -f, --follow     follow the runtime log
  -n, --lines <n>  read the last <n> lines

Examples:
  coder-studio logs
  coder-studio logs -n 200
  coder-studio logs -f
`);
}

function printOpenHelp() {
  console.log(`coder-studio open

Usage:
  coder-studio open [--host <host>] [--port <port>] [--json]

Options:
  --host <host>  override configured host for this invocation
  --port <port>  override configured port for this invocation
  --json         machine-readable output

Examples:
  coder-studio open
  coder-studio open --json
`);
}

function printDoctorHelp() {
  console.log(`coder-studio doctor

Usage:
  coder-studio doctor [--host <host>] [--port <port>] [--json]

Options:
  --host <host>  override configured host for this invocation
  --port <port>  override configured port for this invocation
  --json         machine-readable output

Examples:
  coder-studio doctor
  coder-studio doctor --json
`);
}

function printConfigHelp() {
  console.log(`coder-studio config

Usage:
  coder-studio config path
  coder-studio config show [--json]
  coder-studio config get <key> [--json]
  coder-studio config set <key> <value>
  coder-studio config unset <key>
  coder-studio config validate [--json]
  coder-studio config root show|set <path>|clear
  coder-studio config password status|set <value>|set --stdin|clear
  coder-studio config auth public-mode <on|off>
  coder-studio config auth session-idle <minutes>
  coder-studio config auth session-max <hours>

Supported keys:
  ${listConfigKeys().join('\n  ')}

Examples:
  coder-studio config show
  coder-studio config get server.port
  coder-studio config set server.port 42033
  coder-studio config root set /srv/coder-studio/workspaces
  coder-studio config password set --stdin
`);
}

function printAuthHelp() {
  console.log(`coder-studio auth

Usage:
  coder-studio auth status [--json]
  coder-studio auth ip list [--json]
  coder-studio auth ip unblock <ip> [--json]
  coder-studio auth ip unblock --all [--json]

Examples:
  coder-studio auth status
  coder-studio auth ip list
  coder-studio auth ip unblock 203.0.113.10
`);
}

function printCompletionHelp() {
  console.log(`coder-studio completion

Usage:
  coder-studio completion <bash|zsh|fish>
  coder-studio completion install <bash|zsh|fish> [--json] [--force]
  coder-studio completion uninstall <bash|zsh|fish> [--json]

Description:
  Print, install, or uninstall shell completion scripts.

Examples:
  eval "$(coder-studio completion bash)"
  source <(coder-studio completion zsh)
  coder-studio completion fish | source
  coder-studio completion install bash
  coder-studio completion install bash --force
  coder-studio completion install zsh --json
  coder-studio completion uninstall bash
`);
}

function printCompletionInstall(result) {
  console.log(`installed: ${result.shell}`);
  console.log(`scriptPath: ${result.scriptPath}`);
  console.log(`scriptUpdated: ${result.scriptUpdated ? 'yes' : 'no'}`);
  if (result.profilePath) {
    console.log(`profilePath: ${result.profilePath}`);
    console.log(`profileUpdated: ${result.profileUpdated ? 'yes' : 'no'}`);
  } else {
    console.log('profilePath: n/a');
    console.log('profileUpdated: no');
  }
  console.log(`activationCommand: ${result.activationCommand}`);
  console.log(`forced: ${result.forced ? 'yes' : 'no'}`);
}

function printCompletionUninstall(result) {
  console.log(`uninstalled: ${result.shell}`);
  console.log(`scriptPath: ${result.scriptPath}`);
  console.log(`scriptRemoved: ${result.scriptRemoved ? 'yes' : 'no'}`);
  if (result.profilePath) {
    console.log(`profilePath: ${result.profilePath}`);
    console.log(`profileUpdated: ${result.profileUpdated ? 'yes' : 'no'}`);
  } else {
    console.log('profilePath: n/a');
    console.log('profileUpdated: no');
  }
}

function printHelpTopic(topic) {
  switch (topic) {
    case undefined:
    case null:
    case '':
    case 'main':
      printHelp();
      return EXIT_SUCCESS;
    case 'start':
      printStartHelp();
      return EXIT_SUCCESS;
    case 'stop':
      printStopHelp();
      return EXIT_SUCCESS;
    case 'restart':
      printRestartHelp();
      return EXIT_SUCCESS;
    case 'status':
      printStatusHelp();
      return EXIT_SUCCESS;
    case 'logs':
      printLogsHelp();
      return EXIT_SUCCESS;
    case 'open':
      printOpenHelp();
      return EXIT_SUCCESS;
    case 'doctor':
      printDoctorHelp();
      return EXIT_SUCCESS;
    case 'config':
      printConfigHelp();
      return EXIT_SUCCESS;
    case 'auth':
      printAuthHelp();
      return EXIT_SUCCESS;
    case 'completion':
      printCompletionHelp();
      return EXIT_SUCCESS;
    default:
      throw usageError(`unsupported help topic: ${topic}`, 'main');
  }
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

function runtimeIsActive(status) {
  return status.status === 'running' || status.status === 'degraded';
}

async function loadLiveRuntimeView(context) {
  const status = await getStatus(context.options);
  if (!runtimeIsActive(status) || !status.managed) {
    return { status, runtimeView: null, authStatus: null, ipBlocks: [], adminError: null };
  }

  try {
    const [runtimeView, authStatus, ipBlocks] = await Promise.all([
      fetchAdminConfig(status.endpoint),
      fetchAdminAuthStatus(status.endpoint),
      fetchAdminIpBlocks(status.endpoint),
    ]);

    return { status, runtimeView, authStatus, ipBlocks, adminError: null };
  } catch (error) {
    return {
      status,
      runtimeView: null,
      authStatus: null,
      ipBlocks: [],
      adminError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadEffectiveConfig(context) {
  const local = context.config;
  const live = await loadLiveRuntimeView(context);
  return {
    ...live,
    snapshot: mergeRuntimeConfigView(local, live.runtimeView),
  };
}

function printFlatConfig(snapshot, { includePaths = true } = {}) {
  if (includePaths) {
    const paths = buildConfigPathsReport(snapshot);
    console.log(`stateDir: ${paths.stateDir}`);
    console.log(`dataDir: ${paths.dataDir}`);
    console.log(`configPath: ${paths.configPath}`);
    console.log(`authPath: ${paths.authPath}`);
  }
  const flat = flattenPublicConfig(snapshot);
  for (const [key, value] of Object.entries(flat)) {
    console.log(`${key}: ${value ?? 'null'}`);
  }
}

function printRuntimeMetadata(status, adminError = null) {
  console.log(`runtime.status: ${status.status}`);
  console.log(`runtime.managed: ${status.managed ? 'yes' : 'no'}`);
  console.log(`runtime.endpoint: ${status.endpoint}`);
  if (adminError) {
    console.log(`runtime.adminError: ${adminError}`);
  }
}

function printConfigMutation(result, snapshot, key) {
  if (result.changedKeys.length === 0) {
    console.log(`unchanged: ${key}`);
  } else {
    console.log(`updated: ${result.changedKeys.join(', ')}`);
  }
  console.log(`${key}: ${getPublicConfigValue(snapshot, key) ?? 'null'}`);
  if (result.sessionsReset) {
    console.log('note: active auth sessions were cleared');
  }
  if (result.restartRequired) {
    console.log('note: restart the runtime to apply the new bind host/port');
  }
}

async function readSecretFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trimEnd();
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function promptHiddenInput(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new CliError('interactive password setup requires a TTY', { exitCode: EXIT_FAILURE });
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  const wasRaw = Boolean(stdin.isRaw);

  emitKeypressEvents(stdin);
  stdin.resume();
  if (!wasRaw) {
    stdin.setRawMode(true);
  }

  stdout.write(label);

  return await new Promise((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      stdin.off('keypress', onKeypress);
      if (!wasRaw) {
        stdin.setRawMode(false);
      }
      stdout.write('\n');
    };

    const finish = (callback) => {
      cleanup();
      callback();
    };

    const onKeypress = (chunk, key = {}) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        finish(() => reject(new CliError('initial password setup cancelled', { exitCode: EXIT_FAILURE })));
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        finish(() => resolve(value));
        return;
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        value = value.slice(0, -1);
        return;
      }

      if (typeof chunk === 'string' && chunk.length > 0 && !key.ctrl && !key.meta) {
        value += chunk;
      }
    };

    stdin.on('keypress', onKeypress);
  });
}

async function ensureInitialPasswordConfigured(context, flags) {
  const status = await getStatus(context.options);
  if (runtimeIsActive(status)) {
    return context;
  }

  const needsPassword = context.config.values.auth.publicMode && !context.config.values.auth.passwordConfigured;
  if (!needsPassword) {
    return context;
  }

  const dbPath = path.join(context.config.paths.dataDir, RUNTIME_DB_FILENAME);
  if (await pathExists(dbPath)) {
    return context;
  }

  if (flags.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      'first launch requires configuring auth.password before start; run `coder-studio config password set --stdin` and retry',
      { exitCode: EXIT_FAILURE },
    );
  }

  console.log('First launch detected. Set an access password before starting Coder Studio.');

  while (true) {
    const password = await promptHiddenInput('New password: ');
    if (!password.trim()) {
      console.log('Password cannot be empty.');
      continue;
    }

    const confirmation = await promptHiddenInput('Confirm password: ');
    if (password !== confirmation) {
      console.log('Passwords do not match. Try again.');
      continue;
    }

    await updateLocalConfig(
      { stateDir: context.config.paths.stateDir, dataDir: context.config.paths.dataDir },
      { 'auth.password': password },
    );

    console.log('Password saved. Starting Coder Studio...');
    return {
      ...context,
      config: await loadLocalConfig({
        stateDir: context.config.paths.stateDir,
        dataDir: context.config.paths.dataDir,
      }),
    };
  }
}

async function applyConfigUpdate(context, key, rawValue, { unset = false } = {}) {
  const status = await getStatus(context.options);
  if (runtimeIsActive(status) && status.managed && isRuntimeConfigKey(key)) {
    const updates = { [key]: unset ? null : normalizeConfigValue(key, rawValue) };
    const result = await patchAdminConfig(status.endpoint, updates);
    const local = await loadLocalConfig({ stateDir: context.config.paths.stateDir, dataDir: context.config.paths.dataDir });
    const snapshot = mergeRuntimeConfigView(local, result.config);
    return { result, snapshot };
  }

  const result = await updateLocalConfig({ stateDir: context.config.paths.stateDir, dataDir: context.config.paths.dataDir }, { [key]: rawValue }, { unset });
  return { result, snapshot: result.snapshot };
}

function assertSupportedConfigKey(key) {
  if (!listConfigKeys().includes(key)) {
    throw usageError(`unsupported config key: ${key}`, 'config');
  }
}

async function handleConfigCommand(positionals, flags, context) {
  const [subcommand, ...rest] = positionals;

  if (!subcommand || flags.help) {
    printConfigHelp();
    return EXIT_SUCCESS;
  }

  if (subcommand === 'path') {
    const report = buildConfigPathsReport(context.config);
    if (flags.json) printJson(report);
    else {
      console.log(`stateDir: ${report.stateDir}`);
      console.log(`dataDir: ${report.dataDir}`);
      console.log(`configPath: ${report.configPath}`);
      console.log(`authPath: ${report.authPath}`);
    }
    return EXIT_SUCCESS;
  }

  if (subcommand === 'show') {
    const effective = await loadEffectiveConfig(context);
    if (flags.json) {
      printJson({
        paths: buildConfigPathsReport(effective.snapshot),
        values: flattenPublicConfig(effective.snapshot),
        runtime: {
          status: effective.status.status,
          managed: effective.status.managed,
          endpoint: effective.status.endpoint,
          live: Boolean(effective.runtimeView),
          adminError: effective.adminError,
        },
      });
    } else {
      printFlatConfig(effective.snapshot);
      printRuntimeMetadata(effective.status, effective.adminError);
      console.log(`runtime.liveConfig: ${effective.runtimeView ? 'yes' : 'no'}`);
    }
    return EXIT_SUCCESS;
  }

  if (subcommand === 'get') {
    const key = rest[0];
    if (!key) {
      throw usageError('config get requires <key>', 'config');
    }
    assertSupportedConfigKey(key);
    const effective = await loadEffectiveConfig(context);
    if (flags.json) {
      if (key === 'auth.password') {
        printJson({ key, configured: effective.snapshot.values.auth.passwordConfigured, hidden: true });
      } else {
        printJson({ key, value: getPublicConfigValue(effective.snapshot, key) });
      }
    } else if (key === 'auth.password') {
      console.log(effective.snapshot.values.auth.passwordConfigured ? 'configured' : 'not configured');
    } else {
      console.log(getPublicConfigValue(effective.snapshot, key) ?? 'null');
    }
    return EXIT_SUCCESS;
  }

  if (subcommand === 'set') {
    const [key, ...valueParts] = rest;
    if (!key || valueParts.length === 0) {
      throw usageError('config set requires <key> <value>', 'config');
    }
    assertSupportedConfigKey(key);
    const value = valueParts.join(' ');
    const { result, snapshot } = await applyConfigUpdate(context, key, value);
    if (flags.json) printJson({ changedKeys: result.changedKeys, restartRequired: result.restartRequired, sessionsReset: result.sessionsReset, values: flattenPublicConfig(snapshot) });
    else printConfigMutation(result, snapshot, key);
    return EXIT_SUCCESS;
  }

  if (subcommand === 'unset') {
    const key = rest[0];
    if (!key) {
      throw usageError('config unset requires <key>', 'config');
    }
    assertSupportedConfigKey(key);
    const { result, snapshot } = await applyConfigUpdate(context, key, null, { unset: true });
    if (flags.json) printJson({ changedKeys: result.changedKeys, restartRequired: result.restartRequired, sessionsReset: result.sessionsReset, values: flattenPublicConfig(snapshot) });
    else printConfigMutation(result, snapshot, key);
    return EXIT_SUCCESS;
  }

  if (subcommand === 'validate') {
    const effective = await loadEffectiveConfig(context);
    const report = validateConfigSnapshot(effective.snapshot);
    if (flags.json) {
      printJson(report);
    } else {
      console.log(`valid: ${report.ok ? 'yes' : 'no'}`);
      if (report.errors.length > 0) {
        console.log('errors:');
        for (const error of report.errors) console.log(`- ${error}`);
      }
      if (report.warnings.length > 0) {
        console.log('warnings:');
        for (const warning of report.warnings) console.log(`- ${warning}`);
      }
    }
    return report.ok ? EXIT_SUCCESS : EXIT_FAILURE;
  }

  if (subcommand === 'root') {
    const [action, ...valueParts] = rest;
    if (action === 'show') {
      const effective = await loadEffectiveConfig(context);
      const value = effective.snapshot.values.root.path;
      if (flags.json) printJson({ key: 'root.path', value });
      else console.log(value ?? 'null');
      return EXIT_SUCCESS;
    }
    if (action === 'set') {
      if (valueParts.length === 0) throw usageError('config root set requires <path>', 'config');
      const value = valueParts.join(' ');
      const { result, snapshot } = await applyConfigUpdate(context, 'root.path', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'root.path');
      return EXIT_SUCCESS;
    }
    if (action === 'clear') {
      const { result, snapshot } = await applyConfigUpdate(context, 'root.path', null, { unset: true });
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'root.path');
      return EXIT_SUCCESS;
    }
    throw usageError(`unsupported config root subcommand: ${action || '(missing)'}`, 'config');
  }

  if (subcommand === 'password') {
    const [action, ...valueParts] = rest;
    if (action === 'status') {
      const effective = await loadEffectiveConfig(context);
      const configured = effective.snapshot.values.auth.passwordConfigured;
      if (flags.json) printJson({ configured });
      else console.log(configured ? 'configured' : 'not configured');
      return EXIT_SUCCESS;
    }
    if (action === 'set') {
      const value = flags.stdin ? await readSecretFromStdin() : valueParts.join(' ');
      if (!value) throw usageError('config password set requires <value> or --stdin', 'config');
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.password', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, configured: snapshot.values.auth.passwordConfigured, sessionsReset: result.sessionsReset });
      else printConfigMutation(result, snapshot, 'auth.password');
      return EXIT_SUCCESS;
    }
    if (action === 'clear') {
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.password', null, { unset: true });
      if (flags.json) printJson({ changedKeys: result.changedKeys, configured: snapshot.values.auth.passwordConfigured, sessionsReset: result.sessionsReset });
      else printConfigMutation(result, snapshot, 'auth.password');
      return EXIT_SUCCESS;
    }
    throw usageError(`unsupported config password subcommand: ${action || '(missing)'}`, 'config');
  }

  if (subcommand === 'auth') {
    const [action, value] = rest;
    if (action === 'public-mode') {
      if (!value) throw usageError('config auth public-mode requires <on|off>', 'config');
      const normalized = normalizeConfigValue('auth.publicMode', value);
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.publicMode', normalized);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot), sessionsReset: result.sessionsReset });
      else printConfigMutation(result, snapshot, 'auth.publicMode');
      return EXIT_SUCCESS;
    }
    if (action === 'session-idle') {
      if (!value) throw usageError('config auth session-idle requires <minutes>', 'config');
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.sessionIdleMinutes', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'auth.sessionIdleMinutes');
      return EXIT_SUCCESS;
    }
    if (action === 'session-max') {
      if (!value) throw usageError('config auth session-max requires <hours>', 'config');
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.sessionMaxHours', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'auth.sessionMaxHours');
      return EXIT_SUCCESS;
    }
    throw usageError(`unsupported config auth subcommand: ${action || '(missing)'}`, 'config');
  }

  throw usageError(`unsupported config subcommand: ${subcommand}`, 'config');
}

function printAuthStatus(report) {
  console.log(`runtime: ${report.runtimeRunning ? 'running' : 'stopped'}`);
  if (report.endpoint) {
    console.log(`endpoint: ${report.endpoint}`);
  }
  if (typeof report.managed === 'boolean') {
    console.log(`managed: ${report.managed ? 'yes' : 'no'}`);
  }
  console.log(`server.host: ${report.server.host}`);
  console.log(`server.port: ${report.server.port}`);
  console.log(`root.path: ${report.root.path ?? 'null'}`);
  console.log(`auth.publicMode: ${report.auth.publicMode}`);
  console.log(`auth.passwordConfigured: ${report.auth.passwordConfigured}`);
  console.log(`auth.sessionIdleMinutes: ${report.auth.sessionIdleMinutes}`);
  console.log(`auth.sessionMaxHours: ${report.auth.sessionMaxHours}`);
  console.log(`blockedIpCount: ${report.blockedIpCount}`);
  if (report.adminError) {
    console.log(`adminError: ${report.adminError}`);
  }
}

function printIpBlocks(entries) {
  if (entries.length === 0) {
    console.log('no blocked IPs');
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.ip} blockedUntil=${entry.blockedUntil} failCount=${entry.failCount}`);
  }
}

async function handleAuthCommand(positionals, flags, context) {
  const [subcommand, ...rest] = positionals;
  if (!subcommand || flags.help) {
    printAuthHelp();
    return EXIT_SUCCESS;
  }

  const live = await loadLiveRuntimeView(context);

  if (subcommand === 'status') {
    const report = live.authStatus
      ? {
          ...live.authStatus,
          runtimeRunning: true,
          managed: live.status.managed,
          endpoint: live.status.endpoint,
          adminError: live.adminError,
          blockedIpCount: live.ipBlocks.length,
        }
      : {
          runtimeRunning: false,
          managed: live.status.managed,
          endpoint: live.status.endpoint,
          adminError: live.adminError,
          server: {
            host: context.config.values.server.host,
            port: context.config.values.server.port,
          },
          root: {
            path: context.config.values.root.path,
          },
          auth: {
            publicMode: context.config.values.auth.publicMode,
            passwordConfigured: context.config.values.auth.passwordConfigured,
            sessionIdleMinutes: context.config.values.auth.sessionIdleMinutes,
            sessionMaxHours: context.config.values.auth.sessionMaxHours,
          },
          blockedIpCount: 0,
        };
    if (flags.json) printJson(report);
    else printAuthStatus(report);
    return EXIT_SUCCESS;
  }

  if (subcommand === 'ip') {
    const [action, value] = rest;
    if (action === 'list') {
      if (flags.json) printJson({ running: runtimeIsActive(live.status), entries: live.ipBlocks });
      else {
        if (!runtimeIsActive(live.status)) console.log('runtime is not running; blocked IPs are memory-only');
        printIpBlocks(live.ipBlocks);
      }
      return EXIT_SUCCESS;
    }
    if (action === 'unblock') {
      if (!runtimeIsActive(live.status)) {
        if (flags.json) printJson({ running: false, removed: 0, entries: [] });
        else console.log('runtime is not running; nothing to unblock');
        return EXIT_SUCCESS;
      }
      const payload = flags.all ? { all: true } : { ip: value };
      if (!payload.all && !payload.ip) {
        throw usageError('auth ip unblock requires <ip> or --all', 'auth');
      }
      const result = await unblockAdminIp(live.status.endpoint, payload);
      if (flags.json) printJson(result);
      else {
        console.log(`removed: ${result.removed}`);
        printIpBlocks(result.entries);
      }
      return EXIT_SUCCESS;
    }
  }

  throw usageError(`unsupported auth subcommand: ${subcommand}`, 'auth');
}

function normalizeCliError(error) {
  if (error instanceof CliError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const configPrefix = 'unsupported config key:';
  if (message.startsWith('unsupported_config_key:')) {
    return usageError(`unsupported config key: ${message.slice('unsupported_config_key:'.length)}`, 'config');
  }

  const messageMap = new Map([
    ['invalid_server_host', 'invalid value for server.host'],
    ['invalid_server_port', 'invalid value for server.port'],
    ['invalid_auth_public_mode', 'invalid value for auth.publicMode; expected on/off or true/false'],
    ['invalid_auth_password', 'invalid value for auth.password'],
    ['invalid_auth_session_idle_minutes', 'invalid value for auth.sessionIdleMinutes'],
    ['invalid_auth_session_max_hours', 'invalid value for auth.sessionMaxHours'],
    ['invalid_logs_tail_lines', 'invalid value for logs.tailLines'],
    ['invalid_system_open_command', 'invalid value for system.openCommand'],
    ['invalid_root_path', 'invalid value for root.path'],
    ['missing_ip', 'missing IP address'],
    ['path_has_no_existing_parent', 'root.path must have an existing parent directory'],
    ['empty_path', 'root.path must not be empty'],
  ]);

  if (messageMap.has(message)) {
    return usageError(messageMap.get(message), 'config');
  }

  if (message.startsWith('invalid_')) {
    return usageError(message.replace(/^invalid_/, 'invalid value: '), 'config');
  }

  if (message.startsWith(configPrefix)) {
    return usageError(message, 'config');
  }

  return new CliError(message, { exitCode: EXIT_FAILURE });
}

function printCliError(error, flags) {
  const normalized = normalizeCliError(error);
  if (flags.json) {
    printJson({
      ok: false,
      error: normalized.message,
      exitCode: normalized.exitCode,
      kind: normalized.exitCode === EXIT_USAGE ? 'usage' : 'runtime',
      helpTopic: normalized.helpTopic ?? undefined,
    });
    return normalized.exitCode;
  }

  console.error(`error: ${normalized.message}`);
  if (normalized.helpTopic === 'config') {
    console.error('hint: run `coder-studio config --help`');
  } else if (normalized.helpTopic === 'auth') {
    console.error('hint: run `coder-studio auth --help`');
  } else if (normalized.helpTopic === 'completion') {
    console.error('hint: run `coder-studio help completion`');
  } else if (normalized.helpTopic === 'main') {
    console.error('hint: run `coder-studio help`');
  }
  return normalized.exitCode;
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, flags, positionals } = parseArgv(argv);

  try {
    if (command === '--version' || command === '-v' || flags.version) {
      console.log(await readPackageVersion());
      return EXIT_SUCCESS;
    }

    if (command === 'help') {
      return printHelpTopic(positionals[0]);
    }

    if (flags.help) {
      return printHelpTopic(command);
    }

    if (command === 'completion') {
      const [modeOrShell, maybeShell, ...rest] = positionals;
      if (!modeOrShell) {
        printCompletionHelp();
        return EXIT_SUCCESS;
      }

      if (modeOrShell === 'install') {
        const shell = maybeShell;
        if (!shell) {
          throw usageError('completion install requires <bash|zsh|fish>', 'completion');
        }
        if (rest.length > 0) {
          throw usageError('completion install accepts exactly one <shell> argument', 'completion');
        }
        if (!SUPPORTED_COMPLETION_SHELLS.includes(shell)) {
          throw usageError(`unsupported completion shell: ${shell}`, 'completion');
        }

        const result = await installCompletionScript(shell, { force: Boolean(flags.force) });
        if (flags.json) printJson(result);
        else printCompletionInstall(result);
        return EXIT_SUCCESS;
      }

      if (modeOrShell === 'uninstall') {
        const shell = maybeShell;
        if (!shell) {
          throw usageError('completion uninstall requires <bash|zsh|fish>', 'completion');
        }
        if (rest.length > 0) {
          throw usageError('completion uninstall accepts exactly one <shell> argument', 'completion');
        }
        if (flags.force) {
          throw usageError('completion uninstall does not support --force', 'completion');
        }
        if (!SUPPORTED_COMPLETION_SHELLS.includes(shell)) {
          throw usageError(`unsupported completion shell: ${shell}`, 'completion');
        }

        const result = await uninstallCompletionScript(shell);
        if (flags.json) printJson(result);
        else printCompletionUninstall(result);
        return EXIT_SUCCESS;
      }

      if (flags.json) {
        throw usageError('completion does not support --json', 'completion');
      }
      if (flags.force) {
        throw usageError('completion does not support --force', 'completion');
      }
      if (maybeShell || rest.length > 0) {
        throw usageError('completion accepts exactly one <shell> argument', 'completion');
      }
      if (!SUPPORTED_COMPLETION_SHELLS.includes(modeOrShell)) {
        throw usageError(`unsupported completion shell: ${modeOrShell}`, 'completion');
      }

      process.stdout.write(generateCompletionScript(modeOrShell));
      return EXIT_SUCCESS;
    }

    if (command === 'config') {
      const context = await resolveCommandContext(flags);
      return await handleConfigCommand(positionals, flags, context);
    }

    if (command === 'auth') {
      const context = await resolveCommandContext(flags);
      return await handleAuthCommand(positionals, flags, context);
    }

    let context = await resolveCommandContext(flags);
    let options = context.options;

    if (command === 'start') {
      context = await ensureInitialPasswordConfigured(context, flags);
      options = context.options;
      const result = await startRuntime({
        ...options,
        foreground: Boolean(flags.foreground),
        onReady: async ({ endpoint, pid }) => {
          if (!flags.json) {
            console.log('coder-studio started');
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
        console.log(`logPath: ${result.logPath}`);
      }
      return result.status === 'failed' ? EXIT_FAILURE : EXIT_SUCCESS;
    }

    if (command === 'stop') {
      const result = await stopRuntime(options);
      if (flags.json) printJson(result);
      else console.log(result.changed ? 'coder-studio stopped' : 'coder-studio already stopped');
      return EXIT_SUCCESS;
    }

    if (command === 'restart') {
      context = await ensureInitialPasswordConfigured(context, flags);
      options = context.options;
      const result = await restartRuntime(options);
      if (flags.json) printJson(result);
      else {
        console.log('coder-studio restarted');
        console.log(`endpoint: ${result.endpoint}`);
        console.log(`pid: ${result.pid ?? 'n/a'}`);
      }
      return EXIT_SUCCESS;
    }

    if (command === 'status') {
      const status = await getStatus(options);
      if (flags.json) printJson(status);
      else printStatus(status);
      return status.status === 'stopped' ? EXIT_FAILURE : EXIT_SUCCESS;
    }

    if (command === 'logs') {
      if (flags.follow) {
        await followLogs(context.options.logPath, Number.isFinite(flags.lines) ? flags.lines : context.config.values.logs.tailLines);
        return EXIT_SUCCESS;
      }
      const output = await readRuntimeLogs({ ...options, lines: Number.isFinite(flags.lines) ? flags.lines : context.config.values.logs.tailLines });
      if (output) console.log(output);
      return EXIT_SUCCESS;
    }

    if (command === 'open') {
      context = await ensureInitialPasswordConfigured(context, flags);
      options = context.options;
      const result = await openRuntime(options);
      if (flags.json) printJson(result);
      else console.log(`opened: ${result.endpoint}`);
      return EXIT_SUCCESS;
    }

    if (command === 'doctor') {
      const report = await doctorRuntime(options);
      await printDoctor(report, Boolean(flags.json));
      return report.status.status === 'running' || report.status.status === 'degraded' ? EXIT_SUCCESS : EXIT_FAILURE;
    }
  } catch (error) {
    return printCliError(error, flags);
  }

  return printCliError(usageError(`unsupported command: ${command}`, 'main'), flags);
}
