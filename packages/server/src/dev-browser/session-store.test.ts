import { describe, expect, it } from "vitest";
import { DevBrowserSessionStore } from "./session-store.js";
import type { DevBrowserTarget } from "./target-url.js";

function target(overrides: Partial<DevBrowserTarget> = {}): DevBrowserTarget {
  return {
    connectHost: "127.0.0.1",
    displayUrl: "http://localhost:8000/app",
    originalHost: "localhost",
    port: 8000,
    targetHash: "",
    targetOrigin: "http://127.0.0.1:8000",
    targetPath: "/app",
    ...overrides,
  };
}

describe("DevBrowserSessionStore", () => {
  it("creates and reads short-lived sessions", () => {
    let now = 1_000;
    const store = new DevBrowserSessionStore({ now: () => now, ttlMs: 10_000 });
    const session = store.create(target());

    expect(session.id).toMatch(/^dev_/);
    expect(session.createdAt).toBe(1_000);
    expect(session.expiresAt).toBe(11_000);
    expect(store.get(session.id)).toMatchObject({
      id: session.id,
      targetOrigin: "http://127.0.0.1:8000",
      targetPath: "/app",
    });

    now = 2_000;
    expect(store.get(session.id)?.lastAccessedAt).toBe(2_000);
  });

  it("expires inactive sessions", () => {
    let now = 1_000;
    const store = new DevBrowserSessionStore({ now: () => now, ttlMs: 500 });
    const session = store.create(target());

    now = 1_501;

    expect(store.get(session.id)).toBeNull();
  });

  it("deletes sessions explicitly", () => {
    const store = new DevBrowserSessionStore({ now: () => 1_000, ttlMs: 10_000 });
    const session = store.create(target());

    expect(store.delete(session.id)).toBe(true);
    expect(store.get(session.id)).toBeNull();
  });
});
