import fs from 'node:fs/promises';
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
  coder-studio start [--host 127.0.0.1] [--port 41033] [--foreground] [--json]
  coder-studio stop [--json]
  coder-studio restart [--json]
  coder-studio status [--json]
  coder-studio logs [-f] [-n 120]
  coder-studio open [--json]
  coder-studio doctor [--json]
  coder-studio config <subcommand>
  coder-studio auth <subcommand>
  coder-studio --version

Run \`coder-studio config --help\` or \`coder-studio auth --help\` for detailed usage.
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
`);
}

function printAuthHelp() {
  console.log(`coder-studio auth

Usage:
  coder-studio auth status [--json]
  coder-studio auth ip list [--json]
  coder-studio auth ip unblock <ip> [--json]
  coder-studio auth ip unblock --all [--json]
`);
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

async function handleConfigCommand(positionals, flags, context) {
  const [subcommand, ...rest] = positionals;

  if (!subcommand || flags.help) {
    printConfigHelp();
    return 0;
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
    return 0;
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
    return 0;
  }

  if (subcommand === 'get') {
    const key = rest[0];
    if (!key) {
      throw new Error('config_get_requires_key');
    }
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
    return 0;
  }

  if (subcommand === 'set') {
    const [key, ...valueParts] = rest;
    if (!key || valueParts.length === 0) {
      throw new Error('config_set_requires_key_and_value');
    }
    const value = valueParts.join(' ');
    const { result, snapshot } = await applyConfigUpdate(context, key, value);
    if (flags.json) printJson({ changedKeys: result.changedKeys, restartRequired: result.restartRequired, sessionsReset: result.sessionsReset, values: flattenPublicConfig(snapshot) });
    else printConfigMutation(result, snapshot, key);
    return 0;
  }

  if (subcommand === 'unset') {
    const key = rest[0];
    if (!key) {
      throw new Error('config_unset_requires_key');
    }
    const { result, snapshot } = await applyConfigUpdate(context, key, null, { unset: true });
    if (flags.json) printJson({ changedKeys: result.changedKeys, restartRequired: result.restartRequired, sessionsReset: result.sessionsReset, values: flattenPublicConfig(snapshot) });
    else printConfigMutation(result, snapshot, key);
    return 0;
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
    return report.ok ? 0 : 1;
  }

  if (subcommand === 'root') {
    const [action, ...valueParts] = rest;
    if (action === 'show') {
      const effective = await loadEffectiveConfig(context);
      const value = effective.snapshot.values.root.path;
      if (flags.json) printJson({ key: 'root.path', value });
      else console.log(value ?? 'null');
      return 0;
    }
    if (action === 'set') {
      if (valueParts.length === 0) throw new Error('config_root_set_requires_path');
      const value = valueParts.join(' ');
      const { result, snapshot } = await applyConfigUpdate(context, 'root.path', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'root.path');
      return 0;
    }
    if (action === 'clear') {
      const { result, snapshot } = await applyConfigUpdate(context, 'root.path', null, { unset: true });
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'root.path');
      return 0;
    }
    throw new Error('unsupported_config_root_subcommand');
  }

  if (subcommand === 'password') {
    const [action, ...valueParts] = rest;
    if (action === 'status') {
      const effective = await loadEffectiveConfig(context);
      const configured = effective.snapshot.values.auth.passwordConfigured;
      if (flags.json) printJson({ configured });
      else console.log(configured ? 'configured' : 'not configured');
      return 0;
    }
    if (action === 'set') {
      const value = flags.stdin ? await readSecretFromStdin() : valueParts.join(' ');
      if (!value) throw new Error('config_password_set_requires_value');
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.password', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, configured: snapshot.values.auth.passwordConfigured, sessionsReset: result.sessionsReset });
      else printConfigMutation(result, snapshot, 'auth.password');
      return 0;
    }
    if (action === 'clear') {
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.password', null, { unset: true });
      if (flags.json) printJson({ changedKeys: result.changedKeys, configured: snapshot.values.auth.passwordConfigured, sessionsReset: result.sessionsReset });
      else printConfigMutation(result, snapshot, 'auth.password');
      return 0;
    }
    throw new Error('unsupported_config_password_subcommand');
  }

  if (subcommand === 'auth') {
    const [action, value] = rest;
    if (action === 'public-mode') {
      if (!value) throw new Error('config_auth_public_mode_requires_value');
      const normalized = normalizeConfigValue('auth.publicMode', value);
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.publicMode', normalized);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot), sessionsReset: result.sessionsReset });
      else printConfigMutation(result, snapshot, 'auth.publicMode');
      return 0;
    }
    if (action === 'session-idle') {
      if (!value) throw new Error('config_auth_session_idle_requires_value');
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.sessionIdleMinutes', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'auth.sessionIdleMinutes');
      return 0;
    }
    if (action === 'session-max') {
      if (!value) throw new Error('config_auth_session_max_requires_value');
      const { result, snapshot } = await applyConfigUpdate(context, 'auth.sessionMaxHours', value);
      if (flags.json) printJson({ changedKeys: result.changedKeys, values: flattenPublicConfig(snapshot) });
      else printConfigMutation(result, snapshot, 'auth.sessionMaxHours');
      return 0;
    }
    throw new Error('unsupported_config_auth_subcommand');
  }

  throw new Error(`unsupported_config_subcommand:${subcommand}`);
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
    return 0;
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
    return 0;
  }

  if (subcommand === 'ip') {
    const [action, value] = rest;
    if (action === 'list') {
      if (flags.json) printJson({ running: runtimeIsActive(live.status), entries: live.ipBlocks });
      else {
        if (!runtimeIsActive(live.status)) console.log('runtime is not running; blocked IPs are memory-only');
        printIpBlocks(live.ipBlocks);
      }
      return 0;
    }
    if (action === 'unblock') {
      if (!runtimeIsActive(live.status)) {
        if (flags.json) printJson({ running: false, removed: 0, entries: [] });
        else console.log('runtime is not running; nothing to unblock');
        return 0;
      }
      const payload = flags.all ? { all: true } : { ip: value };
      if (!payload.all && !payload.ip) throw new Error('auth_ip_unblock_requires_ip_or_all');
      const result = await unblockAdminIp(live.status.endpoint, payload);
      if (flags.json) printJson(result);
      else {
        console.log(`removed: ${result.removed}`);
        printIpBlocks(result.entries);
      }
      return 0;
    }
  }

  throw new Error(`unsupported_auth_subcommand:${subcommand}`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, flags, positionals } = parseArgv(argv);

  if (command === '--version' || command === '-v' || flags.version) {
    console.log(await readPackageVersion());
    return 0;
  }

  if (command === 'help' || flags.help && !['config', 'auth'].includes(command)) {
    printHelp();
    return 0;
  }

  try {
    if (command === 'config') {
      const context = await resolveCommandContext(flags);
      return await handleConfigCommand(positionals, flags, context);
    }

    if (command === 'auth') {
      const context = await resolveCommandContext(flags);
      return await handleAuthCommand(positionals, flags, context);
    }

    const context = await resolveCommandContext(flags);
    const options = context.options;

    if (command === 'start') {
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
      if (flags.follow) {
        await followLogs(context.options.logPath, Number.isFinite(flags.lines) ? flags.lines : context.config.values.logs.tailLines);
        return 0;
      }
      const output = await readRuntimeLogs({ ...options, lines: Number.isFinite(flags.lines) ? flags.lines : context.config.values.logs.tailLines });
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
  } catch (error) {
    if (flags.json) {
      printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } else {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }

  printHelp();
  return 1;
}
