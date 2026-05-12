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
  });

  it("displaces the current holder when a different client claims", () => {
    manager.claim("client-a", "ws-a", request);
    const displaced = manager.claim("client-b", "ws-b", request);

    expect(displaced.active).toBe(true);
    expect(displaced.generation).toBe(2);
    expect(displaced.recoveryMode).toBe("takeover");
    expect(manager.getLease()?.clientInstanceId).toBe("client-b");
  });

  it("allows the same client instance to recover during grace", () => {
    manager.claim("client-a", "ws-a", request);
    manager.onSocketClosed("ws-a");

    const recovered = manager.claim("client-a", "ws-a-reloaded", request);

    expect(recovered.active).toBe(true);
    expect(recovered.recoveryMode).toBe("grace_recover");
  });

  it("rejects heartbeat for stale generations", () => {
    const first = manager.claim("client-a", "ws-a", request);
    manager.claim("client-b", "ws-b", request);

    const ok = manager.heartbeat("client-a", first.generation);

    expect(ok).toBe(false);
  });
});
