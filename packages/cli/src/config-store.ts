import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';

const DEFAULT_DB_FILE = 'coder-studio.db';

export interface CliConfig {
  host?: string;
  port?: number;
  dataDir?: string;
  password?: string;
}

export function getCliConfigPath(): string {
  return join(homedir(), '.coder-studio', 'config.json');
}

export function normalizeDataDir(input: string): string {
  if (input.endsWith('.db')) {
    return input;
  }
  if (basename(input).includes('.')) {
    return input;
  }
  return join(input, DEFAULT_DB_FILE);
}

export function readCliConfig(): CliConfig | null {
  const path = getCliConfigPath();
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CliConfig;
    if (
      (parsed.host !== undefined && typeof parsed.host !== 'string') ||
      (parsed.port !== undefined && typeof parsed.port !== 'number') ||
      (parsed.dataDir !== undefined && typeof parsed.dataDir !== 'string') ||
      (parsed.password !== undefined && typeof parsed.password !== 'string')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCliConfig(config: CliConfig): void {
  const path = getCliConfigPath();
  const dir = join(homedir(), '.coder-studio');
  const normalizedConfig: CliConfig = {
    ...config,
    ...(config.dataDir !== undefined ? { dataDir: normalizeDataDir(config.dataDir) } : {}),
  };
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(normalizedConfig, null, 2), 'utf-8');
}
