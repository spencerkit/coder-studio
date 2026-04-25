import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerFileAssetRoutes } from './file-asset.js';

// Smallest possible PNG (1x1 transparent). We use the bytes directly so the
// test doesn't depend on any fixture files or image libraries.
const PNG_BYTES = Buffer.from(
  '89504E470D0A1A0A0000000D4948445200000001000000010806000000' +
    '1F15C4890000000A49444154789C63000100000005000157CFC4A30000' +
    '0000049454E44AE426082',
  'hex'
);

interface FakeWorkspaceMgr {
  get(id: string): { path: string } | null;
}

async function buildApp(workspacePath: string | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const workspaceMgr: FakeWorkspaceMgr = {
    get: (id: string) => (id === 'ws-1' && workspacePath ? { path: workspacePath } : null),
  };
  registerFileAssetRoutes(app, { workspaceMgr: workspaceMgr as never });
  await app.ready();
  return app;
}

describe('/api/file', () => {
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

  it('streams a png with the correct mime type and size', async () => {
    const filePath = join(testDir, 'pixel.png');
    await writeFile(filePath, PNG_BYTES);
    app = await buildApp(testDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/file?workspaceId=ws-1&path=pixel.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-length']).toBe(String(PNG_BYTES.length));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('returns 400 when workspaceId or path is missing', async () => {
    app = await buildApp(testDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/file?workspaceId=ws-1',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown workspace', async () => {
    app = await buildApp(testDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/file?workspaceId=ghost&path=pixel.png',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'workspace_not_found' });
  });

  it('returns 404 when the requested path is not an allowed image type', async () => {
    await writeFile(join(testDir, 'note.txt'), 'secret');
    app = await buildApp(testDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/file?workspaceId=ws-1&path=note.txt',
    });

    // Non-image extensions must 404 so this endpoint can't be used as a
    // generic exfiltration channel for source files.
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_an_image' });
  });

  it('rejects path escape attempts', async () => {
    app = await buildApp(testDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/file?workspaceId=ws-1&path=../outside.png',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'path_escape' });
  });

  it('returns 404 when the file does not exist', async () => {
    app = await buildApp(testDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/file?workspaceId=ws-1&path=missing.png',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });
});
