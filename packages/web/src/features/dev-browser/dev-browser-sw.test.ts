// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface SwHarness {
  mapRequest(input: {
    clientSessionId?: string;
    referrer?: string;
    requestUrl: string;
    sessions: Record<string, unknown>;
  }): string | null;
}

function loadHarness(origin = "https://studio.example"): SwHarness {
  const script = readFileSync(resolve(process.cwd(), "public/dev-browser-sw.js"), "utf8");
  const listeners: Record<string, unknown> = {};
  const context = {
    URL,
    console,
    clients: { get: async () => null },
    fetch: async () => new Response("ok"),
    self: {
      __coderStudioDevBrowserSwTest: undefined as SwHarness | undefined,
      addEventListener: (name: string, handler: unknown) => {
        listeners[name] = handler;
      },
      location: {
        origin,
      },
      skipWaiting: () => undefined,
    },
  };

  vm.runInNewContext(script, context);
  const harness = context.self.__coderStudioDevBrowserSwTest;
  if (!harness) {
    throw new Error("service worker test harness missing");
  }
  return harness;
}

describe("dev browser service worker mapper", () => {
  const session = {
    id: "dev_1",
    browserProxyBase: "/dev-browser/session/dev_1/proxy",
    targetOrigin: "http://127.0.0.1:8000",
    targetPath: "/app/",
  };

  it("maps root-relative resource URLs using the proxied referrer", () => {
    const harness = loadHarness();

    expect(
      harness.mapRequest({
        requestUrl: "https://studio.example/assets/app.js",
        referrer: "https://studio.example/dev-browser/session/dev_1/proxy/app/",
        sessions: { dev_1: session },
      })
    ).toBe("https://studio.example/dev-browser/session/dev_1/proxy/assets/app.js");
  });

  it("maps hardcoded localhost URLs to the active proxy base", () => {
    const harness = loadHarness();

    expect(
      harness.mapRequest({
        requestUrl: "http://localhost:8000/chunk.js?x=1",
        referrer: "https://studio.example/dev-browser/session/dev_1/proxy/app/",
        sessions: { dev_1: session },
      })
    ).toBe("https://studio.example/dev-browser/session/dev_1/proxy/chunk.js?x=1");
  });

  it("does not rewrite unrelated Coder Studio requests", () => {
    const harness = loadHarness();

    expect(
      harness.mapRequest({
        requestUrl: "https://studio.example/assets/main-app.js",
        referrer: "https://studio.example/workspace",
        sessions: { dev_1: session },
      })
    ).toBeNull();
  });

  it("does not rewrite Coder Studio platform auth requests when previewing the studio vite app", () => {
    const harness = loadHarness("http://studio.example:5173");

    expect(
      harness.mapRequest({
        requestUrl: "http://studio.example:5173/auth/status",
        referrer: "http://studio.example:5173/dev-browser/session/dev_1/proxy/",
        sessions: {
          dev_1: {
            ...session,
            targetOrigin: "http://127.0.0.1:5173",
          },
        },
      })
    ).toBeNull();
  });

  it("does not rewrite Coder Studio platform auth requests for cross-port studio previews", () => {
    const harness = loadHarness("http://studio.example:4173");

    expect(
      harness.mapRequest({
        requestUrl: "http://studio.example:4173/auth/status",
        referrer: "http://studio.example:4173/dev-browser/session/dev_1/proxy/",
        sessions: {
          dev_1: {
            ...session,
            targetOrigin: "http://127.0.0.1:5175",
            preserveStudioPlatformPaths: true,
          },
        },
      })
    ).toBeNull();
  });

  it("continues rewriting cross-port Coder Studio websocket requests through the proxy", () => {
    const harness = loadHarness("http://studio.example:4173");

    expect(
      harness.mapRequest({
        requestUrl: "http://127.0.0.1:5175/ws",
        referrer: "http://studio.example:4173/dev-browser/session/dev_1/proxy/",
        sessions: {
          dev_1: {
            ...session,
            targetOrigin: "http://127.0.0.1:5175",
            preserveStudioPlatformPaths: true,
          },
        },
      })
    ).toBe("http://studio.example:4173/dev-browser/session/dev_1/proxy/ws");
  });
});
