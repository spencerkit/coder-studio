import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import FormData from "form-data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearanceAssetRepo } from "../storage/repositories/appearance-asset-repo.js";
import { registerAppearanceAssetsRoutes } from "./appearance-assets.js";

const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

async function buildApp(deps: {
  uploadsDir: string;
  repo: AppearanceAssetRepo;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
  registerAppearanceAssetsRoutes(app, deps);
  await app.ready();
  return app;
}

async function postAppearanceAsset(
  app: FastifyInstance,
  file: { name: string; buffer: Buffer; contentType: string }
) {
  const form = new FormData();
  form.append("file", file.buffer, {
    filename: file.name,
    contentType: file.contentType,
  });
  return app.inject({
    method: "POST",
    url: "/api/appearance-assets",
    headers: form.getHeaders(),
    payload: form.getBuffer(),
  });
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(child)));
      continue;
    }
    if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

describe("appearance-assets routes", () => {
  let tempDir: string;
  let uploadsDir: string;
  let repo: AppearanceAssetRepo;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "appearance-assets-route-"));
    uploadsDir = join(tempDir, "uploads");
    repo = new AppearanceAssetRepo({
      filePath: join(tempDir, "appearance-assets.json"),
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uploads a png appearance asset and returns asset metadata", async () => {
    app = await buildApp({ uploadsDir, repo });
    const res = await postAppearanceAsset(app, {
      name: "pixel.png",
      buffer: PNG_BYTES,
      contentType: "image/png",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().asset.mime).toBe("image/png");
    expect(res.json().asset.url).toMatch(/^\/api\/appearance-assets\//);

    const [stored] = repo.list();
    expect(stored).toMatchObject({
      id: res.json().asset.assetId,
      fileName: "pixel.png",
      mime: "image/png",
      size: PNG_BYTES.length,
    });
    expect(await readFile(stored.storagePath)).toEqual(PNG_BYTES);
  });

  it("rejects non-image appearance uploads", async () => {
    app = await buildApp({ uploadsDir, repo });
    const res = await postAppearanceAsset(app, {
      name: "notes.txt",
      buffer: Buffer.from("not-an-image"),
      contentType: "text/plain",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "invalid_file_type" });
    expect(repo.list()).toEqual([]);
    expect(await listFilesRecursive(uploadsDir)).toEqual([]);
  });

  it("serves an uploaded asset back through GET /api/appearance-assets/:assetId", async () => {
    app = await buildApp({ uploadsDir, repo });
    const uploadRes = await postAppearanceAsset(app, {
      name: "pixel.png",
      buffer: PNG_BYTES,
      contentType: "image/png",
    });
    const assetId = uploadRes.json().asset.assetId as string;

    const getRes = await app.inject({
      method: "GET",
      url: `/api/appearance-assets/${assetId}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers["content-type"]).toBe("image/png");
    expect(getRes.headers["cache-control"]).toBe("no-store");
    expect(getRes.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it("deletes an asset and removes both metadata and file contents", async () => {
    app = await buildApp({ uploadsDir, repo });
    const uploadRes = await postAppearanceAsset(app, {
      name: "pixel.png",
      buffer: PNG_BYTES,
      contentType: "image/png",
    });
    const assetId = uploadRes.json().asset.assetId as string;
    const storedPath = repo.get(assetId)?.storagePath;

    expect(storedPath).toBeDefined();
    await stat(storedPath as string);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/appearance-assets/${assetId}`,
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ ok: true });
    expect(repo.list()).toEqual([]);
    await expect(stat(storedPath as string)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
