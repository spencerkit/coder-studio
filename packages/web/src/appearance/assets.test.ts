import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceAssetError, deleteAppearanceAsset, uploadAppearanceAsset } from "./assets";

describe("appearance asset client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads an appearance asset and returns normalized metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        asset: {
          assetId: "asset-1",
          url: "/api/appearance-assets/asset-1",
          mime: "image/png",
          size: 123,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const asset = await uploadAppearanceAsset(
      new File(["png"], "wallpaper.png", { type: "image/png" })
    );

    expect(asset).toEqual({
      assetId: "asset-1",
      url: "/api/appearance-assets/asset-1",
      mime: "image/png",
      size: 123,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/appearance-assets", {
      method: "POST",
      body: expect.any(FormData),
    });
  });

  it("throws a typed error when upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          error: "invalid_file_type",
        }),
      })
    );

    await expect(
      uploadAppearanceAsset(new File(["bad"], "notes.txt", { type: "text/plain" }))
    ).rejects.toEqual(
      expect.objectContaining<Partial<AppearanceAssetError>>({
        name: "AppearanceAssetError",
        code: "invalid_file_type",
      })
    );
  });

  it("deletes an appearance asset by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteAppearanceAsset("asset-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/appearance-assets/asset-1", {
      method: "DELETE",
    });
  });
});
