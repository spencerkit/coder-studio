import { describe, expect, it } from "vitest";
import {
  buildProxyWebSocketRequestOptions,
  filterProxyRequestHeaders,
  filterProxyResponseHeaders,
  rewriteProxyLocationHeader,
  rewriteProxyUrlReference,
} from "./proxy-headers.js";

describe("dev browser proxy headers", () => {
  it("strips hop-by-hop request headers and sets the target host", () => {
    expect(
      Object.fromEntries(
        filterProxyRequestHeaders(
          {
            connection: "upgrade",
            host: "coder.example",
            upgrade: "websocket",
            cookie: "coder_studio_auth=secret",
            accept: "text/html",
          },
          "127.0.0.1:8000"
        )
      )
    ).toEqual({
      accept: "text/html",
      host: "127.0.0.1:8000",
    });
  });

  it("strips unsafe response headers", () => {
    const headers = new Headers({
      "content-type": "text/html",
      "content-length": "200",
      "content-encoding": "gzip",
      connection: "keep-alive",
      "set-cookie": "sid=abc",
    });

    expect(Object.fromEntries(filterProxyResponseHeaders(headers))).toEqual({
      "content-type": "text/html",
    });
  });

  it("strips websocket transport headers and preserves subprotocols", () => {
    expect(
      buildProxyWebSocketRequestOptions({
        connection: "Upgrade",
        upgrade: "websocket",
        host: "coder.example",
        "sec-websocket-key": "secret",
        "sec-websocket-version": "13",
        "sec-websocket-extensions": "permessage-deflate",
        "sec-websocket-protocol": "json, superjson",
        cookie: "coder_studio_auth=secret",
        authorization: "Bearer secret",
        origin: "https://coder.example",
        "x-trace-id": "trace-1",
      })
    ).toEqual({
      headers: {
        "x-trace-id": "trace-1",
      },
      protocols: ["json", "superjson"],
    });
  });

  it("overrides websocket user-agent when provided", () => {
    expect(
      buildProxyWebSocketRequestOptions(
        {
          "user-agent": "Coder Studio Browser",
          "x-trace-id": "trace-1",
        },
        {
          userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile",
        }
      )
    ).toEqual({
      headers: {
        "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile",
        "x-trace-id": "trace-1",
      },
    });
  });

  it("rewrites loopback redirect locations into browser proxy paths", () => {
    expect(
      rewriteProxyLocationHeader("http://localhost:8000/dashboard?tab=1", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/dashboard?tab=1");

    expect(
      rewriteProxyLocationHeader("/login", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/login");

    expect(
      rewriteProxyLocationHeader("//localhost:8000/dashboard?tab=1", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/dashboard?tab=1");
  });

  it("does not rewrite external protocol-relative redirect locations", () => {
    expect(
      rewriteProxyLocationHeader("//example.com/dashboard", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("//example.com/dashboard");
  });

  it("rewrites root-relative and matching loopback URL references", () => {
    expect(
      rewriteProxyUrlReference("/assets/app.css", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/assets/app.css");

    expect(
      rewriteProxyUrlReference("http://localhost:8000/images/logo.png", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/images/logo.png");

    expect(
      rewriteProxyUrlReference("./relative.svg", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("./relative.svg");

    expect(
      rewriteProxyUrlReference("http://localhost:3000/images/logo.png", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("http://localhost:3000/images/logo.png");
  });
});
