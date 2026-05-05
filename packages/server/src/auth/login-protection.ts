import type { FastifyRequest } from "fastify";
import {
  type AuthLoginBlockRecord,
  AuthLoginBlockRepo,
} from "../storage/repositories/auth-login-block-repo.js";

export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LOGIN_BLOCK_MS = 24 * 60 * 60 * 1000;

export interface ActiveLoginBlock {
  ip: string;
  failedCount: number;
  blockedUntil: number;
}

function parseForwardedIp(rawHeader: string | string[] | undefined): string | null {
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!headerValue) {
    return null;
  }

  const clientIp = headerValue
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean);

  return clientIp ?? null;
}

export function resolveClientIp(request: Pick<FastifyRequest, "headers" | "ip">): string {
  return parseForwardedIp(request.headers["x-forwarded-for"]) ?? request.ip;
}

export class AuthLoginProtection {
  constructor(private readonly repo: AuthLoginBlockRepo) {}

  getActiveBlock(ip: string, now: number): ActiveLoginBlock | null {
    const record = this.repo.get(ip);
    if (!record) {
      return null;
    }

    if (record.blockedUntil !== null && record.blockedUntil > now) {
      return {
        ip,
        failedCount: record.failedCount,
        blockedUntil: record.blockedUntil,
      };
    }

    if (this.shouldReset(record, now)) {
      this.repo.delete(ip);
    }

    return null;
  }

  recordFailure(ip: string, now: number): AuthLoginBlockRecord {
    return this.repo.recordFailure(
      ip,
      now,
      now - LOGIN_WINDOW_MS,
      LOGIN_FAILURE_LIMIT,
      LOGIN_BLOCK_MS
    );
  }

  clearFailures(ip: string): void {
    this.repo.delete(ip);
  }

  private shouldReset(record: AuthLoginBlockRecord, now: number): boolean {
    if (record.blockedUntil !== null && record.blockedUntil <= now) {
      return true;
    }

    return now - record.lastFailedAt > LOGIN_WINDOW_MS;
  }
}
