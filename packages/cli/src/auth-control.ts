import { dirname, join } from "node:path";
import { AuthLoginBlockRepo, parseServerConfig } from "@coder-studio/server";
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
  const repo = new AuthLoginBlockRepo({
    filePath: join(dirname(resolveDataDir()), "state", "auth-login-blocks.json"),
  });
  return repo.listActiveBlocks(now).map((record) => ({
    ip: record.ip,
    failedCount: record.failedCount,
    firstFailedAt: record.firstFailedAt,
    lastFailedAt: record.lastFailedAt,
    blockedUntil: record.blockedUntil ?? 0,
  }));
}

export async function clearAuthBlockByIp(ip: string): Promise<boolean> {
  const repo = new AuthLoginBlockRepo({
    filePath: join(dirname(resolveDataDir()), "state", "auth-login-blocks.json"),
  });
  return repo.delete(ip);
}
