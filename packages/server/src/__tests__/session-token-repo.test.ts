import { describe, expect, it, vi } from "vitest";
import { type SessionAutomationTokenRecord, SessionTokenRepo } from "../auth/session-token-repo.js";

function expectTokenRecordShape(record: SessionAutomationTokenRecord | undefined): asserts record {
  expect(record).toBeDefined();
  expect(record?.token).toMatch(/^[a-f0-9]{64}$/);
  expect(record?.createdAt).toBeTypeOf("number");
}

describe("SessionTokenRepo", () => {
  it("issues high-entropy session automation tokens and looks them up", () => {
    const repo = new SessionTokenRepo();

    const record = repo.issue({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "claude",
      permissions: ["session:read", "git:read"],
    });

    expectTokenRecordShape(record);
    expect(record.sessionId).toBe("sess-1");
    expect(record.workspaceId).toBe("ws-1");
    expect(record.providerId).toBe("claude");
    expect(record.mode).toBe("loopback_runtime");
    expect(record.permissions).toEqual(["session:read", "git:read"]);
    expect(repo.get(record.token)).toEqual(record);
  });

  it("revokes individual tokens", () => {
    const repo = new SessionTokenRepo();
    const record = repo.issue({
      sessionId: "sess-2",
      workspaceId: "ws-1",
      providerId: "codex",
      permissions: ["session:read"],
    });

    expect(repo.revoke(record.token)).toBe(true);
    expect(repo.get(record.token)).toBeUndefined();
    expect(repo.revoke(record.token)).toBe(false);
  });

  it("revokes the active token when a session ends", () => {
    const repo = new SessionTokenRepo();
    const first = repo.issue({
      sessionId: "sess-3",
      workspaceId: "ws-1",
      providerId: "claude",
      permissions: ["session:read"],
    });
    const second = repo.issue({
      sessionId: "sess-3",
      workspaceId: "ws-1",
      providerId: "claude",
      permissions: ["session:read", "git:read"],
    });

    expect(repo.get(first.token)).toEqual(first);
    expect(repo.get(second.token)).toEqual(second);

    repo.revokeBySessionId("sess-3");

    expect(repo.get(first.token)).toBeUndefined();
    expect(repo.get(second.token)).toBeUndefined();
  });

  it("expires remote-runtime tokens and revokes them by runtime id", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T00:00:00.000Z"));

    try {
      const repo = new SessionTokenRepo();
      const remote = repo.issue({
        sessionId: "sess-remote-1",
        workspaceId: "ws-1",
        providerId: "claude",
        permissions: ["session:read"],
        mode: "remote_runtime",
        runtimeId: "wsl:ws-1",
        ttlMs: 1_000,
      });
      const sibling = repo.issue({
        sessionId: "sess-remote-2",
        workspaceId: "ws-2",
        providerId: "claude",
        permissions: ["session:read"],
        mode: "remote_runtime",
        runtimeId: "wsl:ws-1",
        ttlMs: 60_000,
      });
      const loopback = repo.issue({
        sessionId: "sess-native-1",
        workspaceId: "ws-3",
        providerId: "codex",
        permissions: ["session:read"],
      });

      expect(remote.runtimeId).toBe("wsl:ws-1");
      expect(remote.expiresAt).toBe(remote.createdAt + 1_000);
      expect(repo.get(remote.token)).toEqual(remote);

      vi.advanceTimersByTime(1_001);
      expect(repo.get(remote.token)).toBeUndefined();
      expect(repo.get(loopback.token)).toEqual(loopback);

      repo.revokeByRuntimeId("wsl:ws-1");
      expect(repo.get(sibling.token)).toBeUndefined();
      expect(repo.get(loopback.token)).toEqual(loopback);
    } finally {
      vi.useRealTimers();
    }
  });
});
