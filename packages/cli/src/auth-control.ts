import {
  AuthLoginBlockRepo,
  closeDatabase,
  openDatabase,
  parseServerConfig,
} from "@coder-studio/server";
import { readCliConfig } from "./config-store.js";

export interface CliAuthBlock {
  ip: string;
  failedCount: number;
  firstFailedAt: number;
  lastFailedAt: number;
  blockedUntil: number;
}

function resolveDataDir(): string {
  const savedConfig = readCliConfig();
  return parseServerConfig({
    ...(savedConfig?.dataDir !== undefined ? { dataDir: savedConfig.dataDir } : {}),
  }).dataDir;
}

export async function listAuthBlocks(now = Date.now()): Promise<CliAuthBlock[]> {
  const db = openDatabase(resolveDataDir());
  try {
    const repo = new AuthLoginBlockRepo(db);
    return repo.listActiveBlocks(now).map((record) => ({
      ip: record.ip,
      failedCount: record.failedCount,
      firstFailedAt: record.firstFailedAt,
      lastFailedAt: record.lastFailedAt,
      blockedUntil: record.blockedUntil ?? 0,
    }));
  } finally {
    closeDatabase(db);
  }
}

export async function clearAuthBlockByIp(ip: string): Promise<boolean> {
  const db = openDatabase(resolveDataDir());
  try {
    const repo = new AuthLoginBlockRepo(db);
    return repo.delete(ip);
  } finally {
    closeDatabase(db);
  }
}
