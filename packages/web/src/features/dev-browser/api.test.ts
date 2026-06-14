import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevBrowserSession, deleteDevBrowserSession } from "./api";

describe("dev browser api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates and deletes sessions with credentialed fetch", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/dev-proxy/session" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: "dev_1",
            browserUrl: "/dev-browser/session/dev_1/",
            browserProxyBase: "/dev-browser/session/dev_1/proxy",
            targetOrigin: "http://127.0.0.1:8000",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url === "/api/dev-proxy/session/dev_1" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const created = await createDevBrowserSession("localhost:8000");
    await deleteDevBrowserSession("dev_1");

    expect(created.browserUrl).toBe("/dev-browser/session/dev_1/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev-proxy/session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ url: "localhost:8000" }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev-proxy/session/dev_1",
      expect.objectContaining({ method: "DELETE", credentials: "include" })
    );
  });

  it("sends userAgent in the create session request body when provided", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "dev_1",
            browserUrl: "/dev-browser/session/dev_1/",
            browserProxyBase: "/dev-browser/session/dev_1/proxy",
            targetOrigin: "http://127.0.0.1:8000",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createDevBrowserSession("localhost:8000", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev-proxy/session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          url: "localhost:8000",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
        }),
      })
    );
  });
});
