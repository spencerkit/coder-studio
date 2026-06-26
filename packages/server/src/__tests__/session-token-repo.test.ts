import { describe, expect, it } from "vitest";
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
});
