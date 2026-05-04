import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteWorkspaceUploads,
  enforceBucketCap,
  runStartupGc,
} from './cleanup.js';
import { UPLOAD_TTL_HOURS } from './constants.js';

async function writeWithMtime(filePath: string, size: number, mtimeSec: number) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.alloc(size, 0));
  await utimes(filePath, mtimeSec, mtimeSec);
}

describe('deleteWorkspaceUploads', () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'cs-uploads-'));
  });

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('removes the workspace bucket recursively', async () => {
    const a = join(uploadsDir, 'ws-1', '2026-05-03', 'a.png');
    const b = join(uploadsDir, 'ws-1', '2026-05-03', 'b.txt');
    await writeWithMtime(a, 1, 1_000);
    await writeWithMtime(b, 1, 2_000);

    await deleteWorkspaceUploads(uploadsDir, 'ws-1');

    expect(existsSync(join(uploadsDir, 'ws-1'))).toBe(false);
  });

  it('is a no-op when the bucket does not exist', async () => {
    await expect(
      deleteWorkspaceUploads(uploadsDir, 'never-existed')
    ).resolves.toBeUndefined();
  });

  it('rejects invalid workspace ids without touching disk', async () => {
    await expect(
      deleteWorkspaceUploads(uploadsDir, '../escape')
    ).rejects.toThrow(/invalid workspace id/i);
  });
});

describe('enforceBucketCap', () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'cs-bucket-'));
  });

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('is a no-op when bucket size is under cap', async () => {
    const file = join(uploadsDir, 'ws-1', 'd', 'small.bin');
    await writeWithMtime(file, 100, 1_000);

    await enforceBucketCap(uploadsDir, 'ws-1', 1024 * 1024);

    expect(existsSync(file)).toBe(true);
  });

  it('evicts oldest files until the bucket fits the cap', async () => {
    const a = join(uploadsDir, 'ws-1', 'd', 'a.bin');
    const b = join(uploadsDir, 'ws-1', 'd', 'b.bin');
    const c = join(uploadsDir, 'ws-1', 'd', 'c.bin');
    await writeWithMtime(a, 60, 1_000);
    await writeWithMtime(b, 60, 2_000);
    await writeWithMtime(c, 60, 3_000);

    await enforceBucketCap(uploadsDir, 'ws-1', 100);

    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
    expect(existsSync(c)).toBe(true);
  });

  it('ignores non-file entries while computing bucket size', async () => {
    await mkdir(join(uploadsDir, 'ws-1', 'nested', 'dir'), { recursive: true });
    const keep = join(uploadsDir, 'ws-1', 'nested', 'keep.bin');
    await writeWithMtime(keep, 10, 1_000);

    await enforceBucketCap(uploadsDir, 'ws-1', 100);

    expect(existsSync(keep)).toBe(true);
  });

  it('handles missing bucket as no-op', async () => {
    await expect(
      enforceBucketCap(uploadsDir, 'ws-missing', 100)
    ).resolves.toBeUndefined();
  });
});

describe('runStartupGc', () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'cs-gc-'));
  });

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('deletes files older than UPLOAD_TTL_HOURS and keeps fresh ones', async () => {
    const expired = join(uploadsDir, 'ws-1', 'old', 'exp.png');
    const fresh = join(uploadsDir, 'ws-1', 'new', 'fresh.png');
    const fourDaysAgoSec =
      (Date.now() - (UPLOAD_TTL_HOURS + 24) * 3_600_000) / 1000;
    const recentSec = Date.now() / 1000;
    await writeWithMtime(expired, 10, fourDaysAgoSec);
    await writeWithMtime(fresh, 10, recentSec);

    await runStartupGc(uploadsDir);

    expect(existsSync(expired)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('removes empty date directories after sweeping', async () => {
    const expired = join(uploadsDir, 'ws-1', 'empty-after', 'a.png');
    const fourDaysAgoSec =
      (Date.now() - (UPLOAD_TTL_HOURS + 24) * 3_600_000) / 1000;
    await writeWithMtime(expired, 10, fourDaysAgoSec);

    await runStartupGc(uploadsDir);

    expect(existsSync(join(uploadsDir, 'ws-1', 'empty-after'))).toBe(false);
  });

  it('skips non-workspace directories but still reaps expired files inside them', async () => {
    const stray = join(uploadsDir, 'manual-dir', '2026-05-01', 'old.txt');
    const fourDaysAgoSec =
      (Date.now() - (UPLOAD_TTL_HOURS + 24) * 3_600_000) / 1000;
    await writeWithMtime(stray, 10, fourDaysAgoSec);

    await runStartupGc(uploadsDir);

    expect(existsSync(stray)).toBe(false);
  });

  it('is a no-op when uploadsDir does not exist', async () => {
    await expect(
      runStartupGc(join(uploadsDir, 'never'))
    ).resolves.toBeUndefined();
  });
});
