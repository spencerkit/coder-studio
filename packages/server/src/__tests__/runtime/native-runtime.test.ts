import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeRuntime } from "../../runtime/native-runtime.js";

describe("NativeRuntimeHandle", () => {
  let stateDir: string;

  afterEach(() => {
    if (stateDir) {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("stores runtime-owned state under state/runtimes/native-default", async () => {
    stateDir = mkdtempSync(join(tmpdir(), "native-runtime-state-"));
    const runtime = await createNativeRuntime({
      runtimeId: "native-default",
      stateRoot: stateDir,
      hostBridge: {
        issueSessionToken: vi.fn(() => ({ token: "token" })),
        revokeSessionTokensBySessionId: vi.fn(),
        getHostApiUrl: () => "http://127.0.0.1:4173",
        emitDomainEvent: vi.fn(),
        broadcast: vi.fn(),
        recordWorkspaceFetch: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      },
      providerRegistry: [],
      workspaceLookup: {
        get: () => undefined,
        list: () => [],
      },
      providerConfigRepoFactory: undefined,
    });

    expect(runtime.id).toBe("native-default");
  });
});
