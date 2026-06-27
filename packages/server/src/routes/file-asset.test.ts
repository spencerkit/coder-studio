import { execFile } from "child_process";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileAssetRoutes } from "./file-asset.js";

const execFileAsync = promisify(execFile);
const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

interface FakeWorkspaceMgr {
  get(id: string): { path: string; targetRuntime?: "native" | "wsl" } | null;
}

async function buildApp(
  workspace: {
    path: string;
    targetRuntime?: "native" | "wsl";
  } | null,
  runtimeRouter?: { executeOnTarget: ReturnType<typeof vi.fn> }
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const workspaceMgr: FakeWorkspaceMgr = {
    get: (id: string) => (id === "ws-1" ? workspace : null),
  };
  registerFileAssetRoutes(app, {
    workspaceMgr: workspaceMgr as never,
    runtimeRouter: runtimeRouter as never,
  });
  await app.ready();
  return app;
}

describe("/api/file", () => {
  let testDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileasset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (app) await app.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it("streams a png with the correct mime type and size", async () => {
    const filePath = join(testDir, "pixel.png");
    await writeFile(filePath, PNG_BYTES);
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=pixel.png",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(PNG_BYTES.length));
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it("streams an image from HEAD when revision is provided", async () => {
    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Add pixel"], { cwd: testDir });

    const nextBytes = Buffer.from(PNG_BYTES);
    nextBytes[nextBytes.length - 1] ^= 0x01;
    await writeFile(join(testDir, "pixel.png"), nextBytes);
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=pixel.png&revision=HEAD",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it("streams an image from a strict commit sha revision", async () => {
    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Add pixel"], { cwd: testDir });
    const sha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: testDir })).stdout.trim();
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: `/api/file?workspaceId=ws-1&path=pixel.png&revision=${sha}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it("returns 400 when workspaceId or path is missing", async () => {
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1",
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown workspace", async () => {
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ghost&path=pixel.png",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "workspace_not_found" });
  });

  it("returns 404 when the requested path is not an allowed image type", async () => {
    await writeFile(join(testDir, "note.txt"), "secret");
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=note.txt",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_an_image" });
  });

  it("rejects path escape attempts", async () => {
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=../outside.png",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "path_escape" });
  });

  it("rejects invalid revision selectors for the image asset route", async () => {
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=pixel.png&revision=HEAD~1",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_revision" });
  });

  it("rejects symlinked image paths that resolve outside the workspace root", async () => {
    const outsideDir = join(
      tmpdir(),
      `fileasset-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const outsideFile = join(outsideDir, "secret.txt");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, join(testDir, "escape.png"));
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=escape.png",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "path_escape" });

    await rm(outsideDir, { recursive: true, force: true });
  });

  it("streams images when the workspace root is /", async () => {
    const filePath = join(testDir, "pixel.png");
    await writeFile(filePath, PNG_BYTES);
    app = await buildApp({ path: "/" });

    const res = await app.inject({
      method: "GET",
      url: `/api/file?workspaceId=ws-1&path=${filePath.slice(1)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(PNG_BYTES.length));
  });

  it("returns 404 when the file does not exist", async () => {
    app = await buildApp({ path: testDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=missing.png",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  it("proxies WSL workspace image reads through runtime routing", async () => {
    const executeOnTarget = vi.fn(async () => ({
      mime: "image/png",
      size: PNG_BYTES.length,
      bytesBase64: PNG_BYTES.toString("base64"),
    }));
    app = await buildApp(
      {
        path: "/home/spencer/project",
        targetRuntime: "wsl",
      },
      { executeOnTarget }
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/file?workspaceId=ws-1&path=pixel.png",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(PNG_BYTES.length));
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
    expect(executeOnTarget).toHaveBeenCalledWith(
      { kind: "workspace", workspaceId: "ws-1" },
      "file.asset.read",
      {
        workspaceId: "ws-1",
        path: "pixel.png",
        revision: undefined,
      }
    );
  });
});
