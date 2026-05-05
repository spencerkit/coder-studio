import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadError, uploadFiles } from "./upload-files.js";

describe("uploadFiles", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts multipart form-data and returns paths on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        files: [{ path: "/abs/a.png", originalName: "a.png", size: 10 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFiles({
      workspaceId: "ws-1",
      files: [new File(["x"], "a.png", { type: "image/png" })],
    });

    expect(result).toEqual([{ path: "/abs/a.png", originalName: "a.png", size: 10 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/uploads");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.credentials).toBe("include");
  });

  it("throws UploadError with server error code on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({ ok: false, error: "file_too_large" }),
      })
    );

    await expect(
      uploadFiles({
        workspaceId: "ws-1",
        files: [new File(["x"], "a.png")],
      })
    ).rejects.toMatchObject({
      name: "UploadError",
      code: "file_too_large",
      status: 413,
    } satisfies Partial<UploadError>);
  });

  it("throws UploadError on fetch reject", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(
      uploadFiles({
        workspaceId: "ws-1",
        files: [new File(["x"], "a.png")],
      })
    ).rejects.toMatchObject({ name: "UploadError", code: "network_error" });
  });
});
