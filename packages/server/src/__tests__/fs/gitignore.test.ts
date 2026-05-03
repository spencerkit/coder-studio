/**
 * Tests for gitignore filter module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGitignoreFilter, createWatcherIgnoreFilter } from '../../fs/gitignore.js';

describe('createGitignoreFilter', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `gitignore-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('skips dotfiles, node_modules, .git when no .gitignore exists', () => {
    const filter = createGitignoreFilter(testDir, testDir);
    expect(filter('file.txt')).toBe(true);
    expect(filter('src')).toBe(true);
    expect(filter('.hidden')).toBe(false);
    expect(filter('.gitignore')).toBe(false);
    expect(filter('node_modules')).toBe(false);
    expect(filter('.git')).toBe(false);
  });

  it('respects .gitignore rules for patterns', async () => {
    await writeFile(join(testDir, '.gitignore'), '*.log\n*.tmp\nbuild/\n.env');

    const filter = createGitignoreFilter(testDir, testDir);
    expect(filter('app.log')).toBe(false);
    expect(filter('error.tmp')).toBe(false);
    expect(filter('file.txt')).toBe(true);
    expect(filter('build')).toBe(false);
    expect(filter('.env')).toBe(false);
    expect(filter('.env.local')).toBe(false);
  });

  it('respects negation patterns', async () => {
    await writeFile(join(testDir, '.gitignore'), '*.log\n!important.log');

    const filter = createGitignoreFilter(testDir, testDir);
    expect(filter('error.log')).toBe(false);
    expect(filter('important.log')).toBe(true);
  });

  it('applies root .gitignore rules relative to subdirectories', async () => {
    await writeFile(join(testDir, '.gitignore'), 'src/generated/\n/root-only.txt');
    await mkdir(join(testDir, 'src'));

    const filter = createGitignoreFilter(testDir, join(testDir, 'src'));

    expect(filter('generated')).toBe(false);
    expect(filter('root-only.txt')).toBe(true);
  });

  it('keeps default hidden and dependency ignores when .gitignore exists', async () => {
    await writeFile(join(testDir, '.gitignore'), '*.log');

    const filter = createGitignoreFilter(testDir, testDir);

    expect(filter('.git')).toBe(false);
    expect(filter('.hidden')).toBe(false);
    expect(filter('node_modules')).toBe(false);
    expect(filter('app.log')).toBe(false);
    expect(filter('file.txt')).toBe(true);
  });
});

describe('createWatcherIgnoreFilter', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `watcher-gitignore-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('keeps .git/ watched but ignores node_modules, .DS_Store, Thumbs.db when no .gitignore', () => {
    const filter = createWatcherIgnoreFilter(testDir);
    expect(filter(join(testDir, '.git/config'))).toBe(false);
    expect(filter(join(testDir, 'node_modules/package'))).toBe(true);
    expect(filter(join(testDir, '.DS_Store'))).toBe(true);
    expect(filter(join(testDir, 'Thumbs.db'))).toBe(true);
    expect(filter(join(testDir, 'file.txt'))).toBe(false);
  });

  it('respects .gitignore rules', async () => {
    await writeFile(join(testDir, '.gitignore'), '*.log\n*.tmp\nbuild/');

    const filter = createWatcherIgnoreFilter(testDir);
    expect(filter(join(testDir, 'app.log'))).toBe(true);
    expect(filter(join(testDir, 'error.tmp'))).toBe(true);
    expect(filter(join(testDir, 'file.txt'))).toBe(false);
  });

  it('keeps default watcher behavior when .gitignore exists', async () => {
    await writeFile(join(testDir, '.gitignore'), '*.log');

    const filter = createWatcherIgnoreFilter(testDir);

    expect(filter(join(testDir, '.git/config'))).toBe(false);
    expect(filter(join(testDir, 'node_modules/package'))).toBe(true);
    expect(filter(join(testDir, '.playwright-mcp/page.yml'))).toBe(true);
    expect(filter(join(testDir, 'app.log'))).toBe(true);
    expect(filter(join(testDir, 'src/index.ts'))).toBe(false);
  });
});
