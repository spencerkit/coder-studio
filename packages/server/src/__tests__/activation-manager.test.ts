import type { FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivationManager } from "../ws/activation.js";

function createMockRequest(): FastifyRequest {
  return {
    ip: "127.0.0.1",
    headers: { "user-agent": "test-agent" },
  } as unknown as FastifyRequest;
}

describe("ActivationManager", () => {
  let manager: ActivationManager;
  const request = createMockRequest();

  beforeEach(() => {
    vi.useRealTimers();
    manager = new ActivationManager({
      heartbeatMs: 10_000,
      leaseExpirationMs: 30_000,
      graceMs: 3_000,
    });
  });

  it("grants the first claimant as active generation 1", () => {
    const result = manager.claim("client-a", "ws-a", request);

    expect(result.active).toBe(true);
    expect(result.generation).toBe(1);
    expect(result.recoveryMode).toBe("fresh");
    expect(result.displacedWsClientId).toBeNull();
  });

  it("displaces the current holder when a different client claims", () => {
    manager.claim("client-a", "ws-a", request);
    const displaced = manager.claim("client-b", "ws-b", request);

    expect(displaced.active).toBe(true);
    expect(displaced.generation).toBe(2);
    expect(displaced.recoveryMode).toBe("takeover");
    expect(displaced.displacedWsClientId).toBe("ws-a");
    expect(manager.getLease()?.clientInstanceId).toBe("client-b");
  });

  it("allows the same client instance to recover during grace", () => {
    const first = manager.claim("client-a", "ws-a", request);
    manager.onSocketClosed("ws-a");

    const recovered = manager.claim("client-a", "ws-a-reloaded", request);

    expect(recovered.active).toBe(true);
    expect(recovered.generation).toBe(first.generation);
    expect(recovered.recoveryMode).toBe("grace_recover");
    expect(recovered.displacedWsClientId).toBeNull();
  });

  it("rebinds the same client instance to a new websocket without bumping generation", () => {
    const first = manager.claim("client-a", "ws-a", request);

    const rebound = manager.claim("client-a", "ws-a-reloaded", request);

    expect(rebound.active).toBe(true);
    expect(rebound.generation).toBe(first.generation);
    expect(rebound.recoveryMode).toBe("grace_recover");
    expect(rebound.displacedWsClientId).toBe("ws-a");
    expect(manager.getLease()).toMatchObject({
      clientInstanceId: "client-a",
      wsClientId: "ws-a-reloaded",
      generation: first.generation,
      graceUntil: null,
    });
  });

  it("rejects heartbeat for stale generations", () => {
    const first = manager.claim("client-a", "ws-a", request);
    manager.claim("client-b", "ws-b", request);

    const ok = manager.heartbeat("client-a", first.generation);

    expect(ok).toBe(false);
  });

  it("ignores release for stale generations and clears only the current lease", () => {
    const first = manager.claim("client-a", "ws-a", request);
    const current = manager.claim("client-b", "ws-b", request);

    manager.release("client-a", first.generation);
    expect(manager.getLease()?.clientInstanceId).toBe("client-b");

    manager.release("client-b", current.generation);
    expect(manager.getLease()).toBeNull();
  });

  it("nulls expired state when getLease is called after expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));

    manager.claim("client-a", "ws-a", request);

    vi.advanceTimersByTime(30_001);

    expect(manager.getLease()).toBeNull();
    expect(manager.getLease()).toBeNull();
  });

  it("refreshes expiry on heartbeat for the active generation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));

    const claim = manager.claim("client-a", "ws-a", request);
    const beforeExpiresAt = manager.getLease()?.expiresAt;

    expect(beforeExpiresAt).toBe(Date.now() + 30_000);

    vi.advanceTimersByTime(5_000);

    const ok = manager.heartbeat("client-a", claim.generation);
    const after = manager.getLease();

    expect(ok).toBe(true);
    expect(after?.expiresAt).toBe(Date.now() + 30_000);
    expect(after?.expiresAt).toBeGreaterThan(beforeExpiresAt ?? 0);
  });
});
