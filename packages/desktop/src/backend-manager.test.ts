import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isExternalBackendReuseEnabled,
  isReusableExternalBackend,
  resolveUserPath,
} from "./backend-manager.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isReusableExternalBackend", () => {
  it("accepts a healthy backend that serves the desktop web UI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        new Response("<!doctype html><html></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(isReusableExternalBackend("http://127.0.0.1:4173")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4173/",
      expect.objectContaining({ headers: { accept: "text/html" } })
    );
  });

  it("rejects a healthy API-only backend without a web UI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ error: "Not Found" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(isReusableExternalBackend("http://127.0.0.1:4173")).resolves.toBe(false);
  });

  it("rejects a root response that is not the HTML web UI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(isReusableExternalBackend("http://127.0.0.1:4173")).resolves.toBe(false);
  });
});

describe("isExternalBackendReuseEnabled", () => {
  it("keeps external server reuse disabled by default", () => {
    expect(isExternalBackendReuseEnabled(undefined)).toBe(false);
    expect(isExternalBackendReuseEnabled("")).toBe(false);
    expect(isExternalBackendReuseEnabled("false")).toBe(false);
  });

  it("requires an explicit true value to enable external server reuse", () => {
    expect(isExternalBackendReuseEnabled("true")).toBe(true);
    expect(isExternalBackendReuseEnabled(" TRUE ")).toBe(true);
  });
});

describe("resolveUserPath", () => {
  it("loads the Windows PowerShell profile path for Explorer-launched Desktop apps", async () => {
    const runShell = vi.fn(async () => ({
      stdout:
        "profile output\n__CODER_STUDIO_PATH__C:\\fnm\\active;C:\\Users\\demo\\AppData\\Roaming\\npm;C:\\Windows",
    }));

    await expect(
      resolveUserPath({
        platform: "win32",
        env: { PATH: "C:\\Windows" },
        runShell,
      })
    ).resolves.toBe("C:\\fnm\\active;C:\\Users\\demo\\AppData\\Roaming\\npm;C:\\Windows");
    expect(runShell).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-NoLogo", "-NonInteractive", "-Command"]),
      expect.objectContaining({ encoding: "utf8", timeout: 5_000, windowsHide: true })
    );
  });

  it("falls back to the inherited Windows path when PowerShell discovery fails", async () => {
    const runShell = vi.fn(async () => {
      throw new Error("PowerShell unavailable");
    });

    await expect(
      resolveUserPath({
        platform: "win32",
        env: { Path: "C:\\Windows;C:\\Tools" },
        runShell,
      })
    ).resolves.toBe("C:\\Windows;C:\\Tools");
    expect(runShell).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit Desktop path without starting a shell", async () => {
    const runShell = vi.fn();

    await expect(
      resolveUserPath({
        platform: "win32",
        env: { CODER_STUDIO_DESKTOP_PATH: " C:\\managed-tools " },
        runShell,
      })
    ).resolves.toBe("C:\\managed-tools");
    expect(runShell).not.toHaveBeenCalled();
  });
});
