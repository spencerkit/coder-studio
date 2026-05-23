import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewSession, deletePreviewSession, updatePreviewSession } from "./api";

describe("preview api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates, updates, and deletes preview sessions with credentialed fetch", async () => {
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const created = await createPreviewSession({
      workspaceId: "ws-1",
      entryPath: "docs/guide/index.html",
      kind: "html",
      content: "<h1>one</h1>",
    });
    const updated = await updatePreviewSession("session-1", { content: "<h1>two</h1>" });
    await deletePreviewSession("session-1");

    expect(created.revision).toBe(1);
    expect(updated.revision).toBe(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/preview/session",
      expect.objectContaining({ credentials: "include", method: "POST" })
    );
  });
});
