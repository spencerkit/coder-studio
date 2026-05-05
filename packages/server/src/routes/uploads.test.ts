import { mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import FormData from "form-data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUploadsRoute } from "./uploads.js";

interface FakeWorkspaceMgr {
  get(id: string): { path: string } | null;
}

async function buildApp(deps: {
  uploadsDir: string;
  workspaceMgr: FakeWorkspaceMgr;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 20 },
  });
  registerUploadsRoute(app, deps);
  await app.ready();
  return app;
}

async function postFiles(
  app: FastifyInstance,
  workspaceId: string,
  files: Array<{ name: string; buffer: Buffer }>
) {
  const form = new FormData();
  if (workspaceId) {
    form.append("workspaceId", workspaceId);
  }
  for (const file of files) {
    form.append("files", file.buffer, { filename: file.name });
  }
  return app.inject({
    method: "POST",
    url: "/api/uploads",
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

describe("POST /api/uploads", () => {
  let uploadsDir: string;
  let app: FastifyInstance;
  const workspaceMgr: FakeWorkspaceMgr = {
    get: (id) => (id === "ws-1" ? { path: "/tmp/anywhere" } : null),
  };

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), "cs-up-route-"));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it("writes a single file to the bucket and returns its absolute path", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const res = await postFiles(app, "ws-1", [
      { name: "screenshot.png", buffer: Buffer.from("PNGDATA") },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].originalName).toBe("screenshot.png");
    expect(body.files[0].size).toBe(7);
    expect(body.files[0].path).toMatch(/\/ws-1\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{8}-screenshot\.png$/);
    expect(await readFile(body.files[0].path)).toEqual(Buffer.from("PNGDATA"));
  });

  it("writes multiple files in a single batch", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const res = await postFiles(app, "ws-1", [
      { name: "a.txt", buffer: Buffer.from("A") },
      { name: "b.txt", buffer: Buffer.from("BB") },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().files).toHaveLength(2);
  });

  it("falls back to screenshot-HHmmss.ext when filename is missing", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const form = new FormData();
    form.append("workspaceId", "ws-1");
    form.append("files", Buffer.from("PNGDATA"), {
      filename: "",
      contentType: "image/png",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().files[0].path).toMatch(/\/[a-f0-9]{8}-screenshot-\d{6}\.png$/);
  });

  it("returns 400 when workspaceId is missing", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const res = await postFiles(app, "", [{ name: "x.txt", buffer: Buffer.from("x") }]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("workspace_required");
  });

  it("returns 400 when no files are sent", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const form = new FormData();
    form.append("workspaceId", "ws-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("no_files");
  });

  it("returns 404 for unknown workspace", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const res = await postFiles(app, "ghost", [{ name: "x.txt", buffer: Buffer.from("x") }]);

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("workspace_not_found");
  });

  it("rejects a later mismatched workspaceId field and cleans already-written files", async () => {
    app = await buildApp({ uploadsDir, workspaceMgr });
    const form = new FormData();
    form.append("workspaceId", "ws-1");
    form.append("files", Buffer.from("A"), { filename: "a.txt" });
    form.append("workspaceId", "ghost");

    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("workspace_mismatch");
    expect(await listFilesRecursive(uploadsDir)).toEqual([]);
  });

  it("refuses to follow a symlinked bucket directory outside the uploads root", async () => {
    const escapedDir = await mkdtemp(join(tmpdir(), "cs-up-escape-"));
    const dateDir = new Date().toISOString().slice(0, 10);
    await mkdir(join(uploadsDir, "ws-1"), { recursive: true });
    await symlink(escapedDir, join(uploadsDir, "ws-1", dateDir), "dir");

    app = await buildApp({ uploadsDir, workspaceMgr });
    const res = await postFiles(app, "ws-1", [
      { name: "escape.txt", buffer: Buffer.from("ESCAPE") },
    ]);

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("write_failed");
    expect(await listFilesRecursive(escapedDir)).toEqual([]);

    await rm(escapedDir, { recursive: true, force: true });
  });

  it("does not create directories inside a symlinked workspace bucket", async () => {
    const escapedDir = await mkdtemp(join(tmpdir(), "cs-up-escape-"));
    await symlink(escapedDir, join(uploadsDir, "ws-1"), "dir");

    app = await buildApp({ uploadsDir, workspaceMgr });
    const res = await postFiles(app, "ws-1", [
      { name: "escape.txt", buffer: Buffer.from("ESCAPE") },
    ]);

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("write_failed");
    expect(await readdir(escapedDir)).toEqual([]);

    await rm(escapedDir, { recursive: true, force: true });
  });

  it("cleans up and returns 404 if the workspace closes after initial validation", async () => {
    const transientWorkspaceMgr: FakeWorkspaceMgr = {
      get: vi
        .fn<(id: string) => { path: string } | null>()
        .mockImplementationOnce((id) => (id === "ws-1" ? { path: "/tmp/anywhere" } : null))
        .mockImplementation(() => null),
    };

    app = await buildApp({ uploadsDir, workspaceMgr: transientWorkspaceMgr });
    const res = await postFiles(app, "ws-1", [{ name: "a.txt", buffer: Buffer.from("A") }]);

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("workspace_not_found");
    expect(await listFilesRecursive(uploadsDir)).toEqual([]);
  });
});
