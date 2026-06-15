import { describe, expect, it } from "vitest";
import { DevBrowserTargetUrlError, parseDevBrowserTargetUrl } from "./target-url.js";

describe("parseDevBrowserTargetUrl", () => {
  it("accepts loopback HTTP URLs with explicit ports", () => {
    expect(parseDevBrowserTargetUrl("http://localhost:8000/app?draft=1#top")).toMatchObject({
      targetOrigin: "http://127.0.0.1:8000",
      targetPath: "/app?draft=1",
      targetHash: "#top",
      connectHost: "127.0.0.1",
      port: 8000,
    });

    expect(parseDevBrowserTargetUrl("http://127.0.0.1:5173/")).toMatchObject({
      targetOrigin: "http://127.0.0.1:5173",
      targetPath: "/",
      targetHash: "",
      connectHost: "127.0.0.1",
      port: 5173,
    });

    expect(parseDevBrowserTargetUrl("http://[::1]:3000/docs")).toMatchObject({
      targetOrigin: "http://[::1]:3000",
      targetPath: "/docs",
      targetHash: "",
      connectHost: "::1",
      port: 3000,
    });

    expect(parseDevBrowserTargetUrl("http://localhost:80/")).toMatchObject({
      targetOrigin: "http://127.0.0.1:80",
      targetPath: "/",
      targetHash: "",
      connectHost: "127.0.0.1",
      port: 80,
    });
  });

  it("normalizes manual input without an explicit protocol to HTTP", () => {
    expect(parseDevBrowserTargetUrl("localhost:8000")).toMatchObject({
      displayUrl: "http://localhost:8000/",
      targetOrigin: "http://127.0.0.1:8000",
      targetPath: "/",
    });
  });

  it("rejects non-loopback and unsafe targets", () => {
    const invalidInputs = [
      "https://localhost:8000",
      "http://localhost",
      "http://localhost:0",
      "http://localhost:8000@evil.test",
      "http://user:pass@localhost:8000",
      "http://192.168.1.20:8000",
      "http://example.com:8000",
      "http://127.1:8000",
      "http://2130706433:8000",
      "http://0x7f000001:8000",
      "http://[0:0:0:0:0:0:0:1]:8000",
      "file:///tmp/index.html",
      "",
    ];

    for (const input of invalidInputs) {
      expect(() => parseDevBrowserTargetUrl(input), input).toThrow(DevBrowserTargetUrlError);
    }
  });
});
