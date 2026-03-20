// @ts-nocheck
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_HOST,
  DEFAULT_LOG_TAIL_LINES,
  DEFAULT_PORT,
  DEFAULT_SESSION_IDLE_MINUTES,
  DEFAULT_SESSION_MAX_HOURS,
  defaultRootPath,
  resolveAuthPath,
  resolveConfigPath,
  resolveDataDir,
  resolveStateDir,
} from './config.mjs';

const CONFIG_VERSION = 1;
const SUPPORTED_KEYS = [
  'server.host',
  'server.port',
  'root.path',
  'auth.publicMode',
  'auth.password',
  'auth.sessionIdleMinutes',
  'auth.sessionMaxHours',
  'system.openCommand',
  'logs.tailLines',
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function trimToNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function asPositiveInteger(value, key) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`invalid_${key}`);
  }
  return number;
}

function asPort(value) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number <= 0 || number > 65535) {
    throw new Error('invalid_server_port');
  }
  return number;
}

function asBoolean(value, key) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  throw new Error(`invalid_${key}`);
}

function expandHome(value) {
  if (!value || !value.startsWith('~')) return value;
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return value;
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(home, value.slice(2));
  }
  return value;
}

function coerceRootPath(value) {
  if (value == null) return null;
  const text = trimToNull(value);
  if (!text) return null;
  return path.resolve(expandHome(text));
}

function sanitizeCliConfig(raw) {
  const config = isObject(raw) ? raw : {};
  const logs = isObject(config.logs) ? config.logs : {};
  const system = isObject(config.system) ? config.system : {};
  const tailLines = Number.isInteger(logs.tailLines) && logs.tailLines > 0
    ? logs.tailLines
    : DEFAULT_LOG_TAIL_LINES;

  return {
    version: CONFIG_VERSION,
    system: {
      openCommand: trimToNull(system.openCommand),
    },
    logs: {
      tailLines,
    },
  };
}

function sanitizeAuthConfig(raw) {
  const file = isObject(raw) ? raw : {};
  const legacyRoots = Array.isArray(file.allowedRoots) ? file.allowedRoots : [];
  const configuredRoot = trimToNull(file.rootPath) || trimToNull(legacyRoots[0]) || null;

  return {
    version: CONFIG_VERSION,
    publicMode: typeof file.publicMode === 'boolean' ? file.publicMode : true,
    password: typeof file.password === 'string' ? file.password.trim() : '',
    rootPath: configuredRoot,
    bindHost: trimToNull(file.bindHost) || DEFAULT_HOST,
    bindPort: Number.isInteger(file.bindPort) && file.bindPort > 0 ? file.bindPort : DEFAULT_PORT,
    sessionIdleMinutes: Number.isInteger(file.sessionIdleMinutes) && file.sessionIdleMinutes > 0
      ? file.sessionIdleMinutes
      : DEFAULT_SESSION_IDLE_MINUTES,
    sessionMaxHours: Number.isInteger(file.sessionMaxHours) && file.sessionMaxHours > 0
      ? file.sessionMaxHours
      : DEFAULT_SESSION_MAX_HOURS,
    sessions: Array.isArray(file.sessions) ? file.sessions : [],
    raw: isObject(raw) ? raw : {},
  };
}

function buildDefaultAuthConfig() {
  return {
    version: CONFIG_VERSION,
    publicMode: true,
    password: '',
    rootPath: defaultRootPath(),
    bindHost: DEFAULT_HOST,
    bindPort: DEFAULT_PORT,
    sessionIdleMinutes: DEFAULT_SESSION_IDLE_MINUTES,
    sessionMaxHours: DEFAULT_SESSION_MAX_HOURS,
    sessions: [],
    raw: {},
  };
}

function snapshotFromParts(paths, cliConfig, authConfig) {
  const passwordConfigured = authConfig.password.trim().length > 0;
  return {
    paths,
    values: {
      server: {
        host: authConfig.bindHost,
        port: authConfig.bindPort,
      },
      root: {
        path: authConfig.rootPath,
      },
      auth: {
        publicMode: authConfig.publicMode,
        passwordConfigured,
        sessionIdleMinutes: authConfig.sessionIdleMinutes,
        sessionMaxHours: authConfig.sessionMaxHours,
      },
      system: {
        openCommand: cliConfig.system.openCommand,
      },
      logs: {
        tailLines: cliConfig.logs.tailLines,
      },
    },
    secrets: {
      password: authConfig.password,
    },
    raw: {
      cli: cliConfig,
      auth: authConfig,
    },
  };
}

export function resolveConfigFiles(input = {}) {
  const stateDir = input.stateDir || resolveStateDir(input.env, input.platform);
  const dataDir = input.dataDir || resolveDataDir(stateDir, input.env);
  return {
    stateDir,
    dataDir,
    configPath: resolveConfigPath(stateDir),
    authPath: resolveAuthPath(dataDir),
  };
}

export async function loadLocalConfig(input = {}) {
  const paths = resolveConfigFiles(input);
  const cliRaw = await readJsonIfExists(paths.configPath);
  const authRaw = await readJsonIfExists(paths.authPath);
  const cliConfig = sanitizeCliConfig(cliRaw);
  const authConfig = authRaw ? sanitizeAuthConfig(authRaw) : buildDefaultAuthConfig();
  return snapshotFromParts(paths, cliConfig, authConfig);
}

export function listConfigKeys() {
  return [...SUPPORTED_KEYS];
}

export function isRuntimeConfigKey(key) {
  return [
    'server.host',
    'server.port',
    'root.path',
    'auth.publicMode',
    'auth.password',
    'auth.sessionIdleMinutes',
    'auth.sessionMaxHours',
  ].includes(key);
}

export function isCliConfigKey(key) {
  return ['system.openCommand', 'logs.tailLines'].includes(key);
}

export function normalizeConfigValue(key, rawValue) {
  switch (key) {
    case 'server.host': {
      const host = trimToNull(rawValue);
      if (!host) throw new Error('invalid_server_host');
      return host;
    }
    case 'server.port':
      return asPort(rawValue);
    case 'root.path':
      return coerceRootPath(rawValue);
    case 'auth.publicMode':
      return asBoolean(rawValue, 'auth_public_mode');
    case 'auth.password':
      return rawValue == null ? '' : String(rawValue).trim();
    case 'auth.sessionIdleMinutes':
      return asPositiveInteger(rawValue, 'auth_session_idle_minutes');
    case 'auth.sessionMaxHours':
      return asPositiveInteger(rawValue, 'auth_session_max_hours');
    case 'system.openCommand':
      return trimToNull(rawValue);
    case 'logs.tailLines':
      return asPositiveInteger(rawValue, 'logs_tail_lines');
    default:
      throw new Error(`unsupported_config_key:${key}`);
  }
}

export function defaultValueForKey(key) {
  switch (key) {
    case 'server.host':
      return DEFAULT_HOST;
    case 'server.port':
      return DEFAULT_PORT;
    case 'root.path':
      return null;
    case 'auth.publicMode':
      return true;
    case 'auth.password':
      return '';
    case 'auth.sessionIdleMinutes':
      return DEFAULT_SESSION_IDLE_MINUTES;
    case 'auth.sessionMaxHours':
      return DEFAULT_SESSION_MAX_HOURS;
    case 'system.openCommand':
      return null;
    case 'logs.tailLines':
      return DEFAULT_LOG_TAIL_LINES;
    default:
      throw new Error(`unsupported_config_key:${key}`);
  }
}

export function getPublicConfigValue(snapshot, key) {
  switch (key) {
    case 'server.host':
      return snapshot.values.server.host;
    case 'server.port':
      return snapshot.values.server.port;
    case 'root.path':
      return snapshot.values.root.path;
    case 'auth.publicMode':
      return snapshot.values.auth.publicMode;
    case 'auth.password':
      return snapshot.values.auth.passwordConfigured ? '(configured)' : '(not configured)';
    case 'auth.sessionIdleMinutes':
      return snapshot.values.auth.sessionIdleMinutes;
    case 'auth.sessionMaxHours':
      return snapshot.values.auth.sessionMaxHours;
    case 'system.openCommand':
      return snapshot.values.system.openCommand;
    case 'logs.tailLines':
      return snapshot.values.logs.tailLines;
    default:
      throw new Error(`unsupported_config_key:${key}`);
  }
}

export function flattenPublicConfig(snapshot) {
  return {
    'server.host': snapshot.values.server.host,
    'server.port': snapshot.values.server.port,
    'root.path': snapshot.values.root.path,
    'auth.publicMode': snapshot.values.auth.publicMode,
    'auth.password': snapshot.values.auth.passwordConfigured ? '(configured)' : '(not configured)',
    'auth.sessionIdleMinutes': snapshot.values.auth.sessionIdleMinutes,
    'auth.sessionMaxHours': snapshot.values.auth.sessionMaxHours,
    'system.openCommand': snapshot.values.system.openCommand,
    'logs.tailLines': snapshot.values.logs.tailLines,
  };
}

function runtimeViewFromSnapshot(snapshot) {
  return {
    server: {
      host: snapshot.values.server.host,
      port: snapshot.values.server.port,
    },
    root: {
      path: snapshot.values.root.path,
    },
    auth: {
      publicMode: snapshot.values.auth.publicMode,
      passwordConfigured: snapshot.values.auth.passwordConfigured,
      sessionIdleMinutes: snapshot.values.auth.sessionIdleMinutes,
      sessionMaxHours: snapshot.values.auth.sessionMaxHours,
    },
  };
}

export function mergeRuntimeConfigView(snapshot, runtimeView = null) {
  if (!runtimeView) {
    return snapshot;
  }

  return {
    ...snapshot,
    values: {
      ...snapshot.values,
      server: {
        host: runtimeView.server?.host ?? snapshot.values.server.host,
        port: runtimeView.server?.port ?? snapshot.values.server.port,
      },
      root: {
        path: runtimeView.root?.path ?? snapshot.values.root.path,
      },
      auth: {
        publicMode: runtimeView.auth?.publicMode ?? snapshot.values.auth.publicMode,
        passwordConfigured: runtimeView.auth?.passwordConfigured ?? snapshot.values.auth.passwordConfigured,
        sessionIdleMinutes: runtimeView.auth?.sessionIdleMinutes ?? snapshot.values.auth.sessionIdleMinutes,
        sessionMaxHours: runtimeView.auth?.sessionMaxHours ?? snapshot.values.auth.sessionMaxHours,
      },
    },
  };
}

function buildCliFile(snapshot) {
  return {
    version: CONFIG_VERSION,
    system: {
      openCommand: snapshot.values.system.openCommand,
    },
    logs: {
      tailLines: snapshot.values.logs.tailLines,
    },
  };
}

function buildAuthFile(snapshot) {
  const raw = isObject(snapshot.raw.auth.raw) ? { ...snapshot.raw.auth.raw } : {};
  const next = {
    ...raw,
    version: CONFIG_VERSION,
    publicMode: snapshot.values.auth.publicMode,
    password: snapshot.secrets.password,
    bindHost: snapshot.values.server.host,
    bindPort: snapshot.values.server.port,
    sessionIdleMinutes: snapshot.values.auth.sessionIdleMinutes,
    sessionMaxHours: snapshot.values.auth.sessionMaxHours,
    sessions: Array.isArray(snapshot.raw.auth.sessions) ? snapshot.raw.auth.sessions : [],
  };

  if (snapshot.values.root.path) {
    next.rootPath = snapshot.values.root.path;
  } else {
    delete next.rootPath;
  }
  delete next.allowedRoots;
  return next;
}

export async function updateLocalConfig(input = {}, updates = {}, { unset = false } = {}) {
  const current = await loadLocalConfig(input);
  const next = structuredClone(current);
  const changedKeys = [];
  let restartRequired = false;
  let sessionsReset = false;

  for (const key of Object.keys(updates)) {
    if (!SUPPORTED_KEYS.includes(key)) {
      throw new Error(`unsupported_config_key:${key}`);
    }

    const value = unset ? defaultValueForKey(key) : normalizeConfigValue(key, updates[key]);
    switch (key) {
      case 'server.host':
        if (next.values.server.host !== value) {
          next.values.server.host = value;
          changedKeys.push(key);
          restartRequired = true;
        }
        break;
      case 'server.port':
        if (next.values.server.port !== value) {
          next.values.server.port = value;
          changedKeys.push(key);
          restartRequired = true;
        }
        break;
      case 'root.path':
        if (next.values.root.path !== value) {
          next.values.root.path = value;
          changedKeys.push(key);
        }
        break;
      case 'auth.publicMode':
        if (next.values.auth.publicMode !== value) {
          next.values.auth.publicMode = value;
          changedKeys.push(key);
          sessionsReset = true;
        }
        break;
      case 'auth.password':
        if (next.secrets.password !== value) {
          next.secrets.password = value;
          next.values.auth.passwordConfigured = value.length > 0;
          changedKeys.push(key);
          sessionsReset = true;
        }
        break;
      case 'auth.sessionIdleMinutes':
        if (next.values.auth.sessionIdleMinutes !== value) {
          next.values.auth.sessionIdleMinutes = value;
          changedKeys.push(key);
        }
        break;
      case 'auth.sessionMaxHours':
        if (next.values.auth.sessionMaxHours !== value) {
          next.values.auth.sessionMaxHours = value;
          changedKeys.push(key);
        }
        break;
      case 'system.openCommand':
        if (next.values.system.openCommand !== value) {
          next.values.system.openCommand = value;
          changedKeys.push(key);
        }
        break;
      case 'logs.tailLines':
        if (next.values.logs.tailLines !== value) {
          next.values.logs.tailLines = value;
          changedKeys.push(key);
        }
        break;
      default:
        throw new Error(`unsupported_config_key:${key}`);
    }
  }

  if (changedKeys.length === 0) {
    return {
      changedKeys,
      restartRequired,
      sessionsReset,
      snapshot: current,
    };
  }

  if (next.values.root.path) {
    await fs.mkdir(next.values.root.path, { recursive: true });
  }

  if (sessionsReset) {
    next.raw.auth.sessions = [];
  }

  await writeJson(current.paths.configPath, buildCliFile(next));
  await writeJson(current.paths.authPath, buildAuthFile(next));

  return {
    changedKeys,
    restartRequired,
    sessionsReset,
    snapshot: await loadLocalConfig(input),
  };
}

export function validateConfigSnapshot(snapshot) {
  const errors = [];
  const warnings = [];
  const flat = runtimeViewFromSnapshot(snapshot);

  if (!trimToNull(flat.server.host)) {
    errors.push('server.host must not be empty');
  }

  if (!Number.isInteger(flat.server.port) || flat.server.port <= 0 || flat.server.port > 65535) {
    errors.push('server.port must be an integer between 1 and 65535');
  }

  if (!Number.isInteger(flat.auth.sessionIdleMinutes) || flat.auth.sessionIdleMinutes <= 0) {
    errors.push('auth.sessionIdleMinutes must be a positive integer');
  }

  if (!Number.isInteger(flat.auth.sessionMaxHours) || flat.auth.sessionMaxHours <= 0) {
    errors.push('auth.sessionMaxHours must be a positive integer');
  }

  if (!Number.isInteger(snapshot.values.logs.tailLines) || snapshot.values.logs.tailLines <= 0) {
    errors.push('logs.tailLines must be a positive integer');
  }

  if (flat.auth.publicMode && !flat.root.path) {
    errors.push('root.path is required when auth.publicMode is enabled');
  }

  if (flat.auth.publicMode && !flat.auth.passwordConfigured) {
    warnings.push('auth.password is not configured; public-mode login will stay unavailable until a password is set');
  }

  if (flat.root.path) {
    try {
      const resolved = path.resolve(flat.root.path);
      if (resolved !== flat.root.path) {
        warnings.push(`root.path will resolve to ${resolved}`);
      }
    } catch {
      errors.push('root.path is not a valid path');
    }
  }

  if (snapshot.values.system.openCommand && !trimToNull(snapshot.values.system.openCommand)) {
    warnings.push('system.openCommand is empty and will be ignored');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function buildConfigPathsReport(snapshot) {
  return {
    stateDir: snapshot.paths.stateDir,
    dataDir: snapshot.paths.dataDir,
    configPath: snapshot.paths.configPath,
    authPath: snapshot.paths.authPath,
  };
}
