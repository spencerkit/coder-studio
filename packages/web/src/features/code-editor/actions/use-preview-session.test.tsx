import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePreviewSession } from "./use-preview-session";

describe("usePreviewSession", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("bootstraps a preview session, debounces content sync, and bumps iframe revision", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "session-1",
          previewUrl: "/api/preview/session/session-1/docs/guide/index.html",
          revision: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: 2 }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ content }) =>
        usePreviewSession({
          enabled: true,
          workspaceId: "ws-1",
          filePath: "docs/guide/index.html",
          content,
          kind: "html",
          debounceMs: 300,
        }),
      { initialProps: { content: "<h1>one</h1>" } }
    );

    await waitFor(() => expect(result.current.iframeSrc).toContain("rev=1"));

    rerender({ content: "<h1>two</h1>" });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.iframeSrc).toContain("rev=2"));
    unmount();
  });

  it("does not immediately resync unchanged content after session bootstrap", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "session-1",
        previewUrl: "/api/preview/session/session-1/docs/guide/index.html",
        revision: 1,
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      usePreviewSession({
        enabled: true,
        workspaceId: "ws-1",
        filePath: "docs/guide/index.html",
        content: "<h1>one</h1>",
        kind: "html",
        debounceMs: 300,
      })
    );

    await waitFor(() => expect(result.current.iframeSrc).toContain("rev=1"));

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("deletes the previous preview session before bootstrapping a new file target", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let createCount = 0;
    let resolveSecondCreate:
      | ((value: {
          ok: boolean;
          json: () => Promise<{ id: string; previewUrl: string; revision: number }>;
        }) => void)
      | null = null;

    const secondCreate = new Promise<{
      ok: boolean;
      json: () => Promise<{ id: string; previewUrl: string; revision: number }>;
    }>((resolve) => {
      resolveSecondCreate = resolve;
    });

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/preview/session" && method === "POST") {
        createCount += 1;
        if (createCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: "session-1",
              previewUrl: "/api/preview/session/session-1/docs/guide/one.md",
              revision: 1,
            }),
          });
        }

        return secondCreate;
      }

      if (url === "/api/preview/session/session-1" && method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }

      if (url === "/api/preview/session/session-2" && method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }

      if (url === "/api/preview/session/session-1" && method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ revision: 2 }),
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ filePath, content }) =>
        usePreviewSession({
          enabled: true,
          workspaceId: "ws-1",
          filePath,
          content,
          kind: "markdown",
          debounceMs: 300,
        }),
      {
        initialProps: {
          filePath: "docs/guide/one.md",
          content: "# one",
        },
      }
    );

    await waitFor(() => expect(result.current.iframeSrc).toContain("session-1"));

    rerender({
      filePath: "docs/guide/two.md",
      content: "# two",
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/preview/session/session-1",
        expect.objectContaining({ method: "DELETE" })
      )
    );

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/preview/session/session-1",
      expect.objectContaining({ method: "PUT" })
    );

    if (!resolveSecondCreate) {
      throw new Error("second create resolver missing");
    }

    resolveSecondCreate({
      ok: true,
      json: async () => ({
        id: "session-2",
        previewUrl: "/api/preview/session/session-2/docs/guide/two.md",
        revision: 1,
      }),
    });

    await waitFor(() => expect(result.current.iframeSrc).toContain("session-2"));

    unmount();
  });
});
