import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase, TerminalRepo, WorkspaceRepo, type NewTerminal, type NewWorkspace } from '../storage/index.js';
import type { Database } from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('TerminalRepo', () => {
  let db: Database;
  let repo: TerminalRepo;
  let workspaceRepo: WorkspaceRepo;
  let tempDir: string;
  let testWorkspace: NewWorkspace;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'terminal-repo-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = openDatabase(dbPath);
    repo = new TerminalRepo(db);
    workspaceRepo = new WorkspaceRepo(db);

    // Create a test workspace for terminals
    testWorkspace = {
      id: 'ws-1',
      path: '/path/to/workspace',
      targetRuntime: 'native',
      openedAt: Date.now(),
      lastActiveAt: Date.now(),
      uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
    };
    workspaceRepo.create(testWorkspace);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a new terminal', () => {
      const newTerminal: NewTerminal = {
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path/to/workspace',
        argv: ['node', 'server.js'],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      };

      const result = repo.create(newTerminal);

      expect(result.id).toBe(newTerminal.id);
      expect(result.workspaceId).toBe(newTerminal.workspaceId);
      expect(result.kind).toBe('agent');
      expect(result.argv).toEqual(['node', 'server.js']);
      expect(result.alive).toBe(true);
    });

    it('should create a terminal with environment and title', () => {
      const newTerminal: NewTerminal = {
        id: 't-2',
        workspaceId: 'ws-1',
        kind: 'shell',
        cwd: '/path/to/workspace',
        argv: ['/bin/bash'],
        env: { NODE_ENV: 'development', PATH: '/usr/bin' },
        title: 'My Terminal',
        cols: 120,
        rows: 30,
        createdAt: Date.now(),
      };

      const result = repo.create(newTerminal);

      expect(result.env).toEqual({ NODE_ENV: 'development', PATH: '/usr/bin' });
      expect(result.title).toBe('My Terminal');
    });
  });

  describe('listByWorkspace', () => {
    it('should list all terminals for a workspace', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: 1000,
      });

      repo.create({
        id: 't-2',
        workspaceId: 'ws-1',
        kind: 'shell',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: 2000,
      });

      const terminals = repo.listByWorkspace('ws-1');

      expect(terminals).toHaveLength(2);
      expect(terminals.map(t => t.id)).toEqual(expect.arrayContaining(['t-1', 't-2']));
    });

    it('should return empty array for workspace with no terminals', () => {
      const terminals = repo.listByWorkspace('ws-1');
      expect(terminals).toHaveLength(0);
    });
  });

  describe('listActiveByWorkspace', () => {
    it('should list only active (non-ended) terminals', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.create({
        id: 't-2',
        workspaceId: 'ws-1',
        kind: 'shell',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      // Mark one as ended
      repo.markEnded('t-2', Date.now(), 0);

      const active = repo.listActiveByWorkspace('ws-1');

      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('t-1');
      expect(active[0].alive).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find a terminal by ID', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: ['node'],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      const result = repo.findById('t-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('t-1');
    });

    it('should return undefined for non-existent terminal', () => {
      const result = repo.findById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('markEnded', () => {
    it('should mark a terminal as ended', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      const endedAt = Date.now();
      repo.markEnded('t-1', endedAt, 0);

      const result = repo.findById('t-1');
      expect(result?.alive).toBe(false);
      expect(result?.endedAt).toBe(endedAt);
      expect(result?.exitCode).toBe(0);
    });

    it('should record non-zero exit code', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.markEnded('t-1', Date.now(), 1);

      const result = repo.findById('t-1');
      expect(result?.exitCode).toBe(1);
    });
  });

  describe('updateDimensions', () => {
    it('should update terminal dimensions', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.updateDimensions('t-1', 120, 30);

      const result = repo.findById('t-1');
      expect(result?.cols).toBe(120);
      expect(result?.rows).toBe(30);
    });
  });

  describe('updateTitle', () => {
    it('should update terminal title', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
        title: 'Old Title',
      });

      repo.updateTitle('t-1', 'New Title');

      const result = repo.findById('t-1');
      expect(result?.title).toBe('New Title');
    });
  });

  describe('delete', () => {
    it('should delete a terminal by ID', () => {
      repo.create({
        id: 't-1',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.delete('t-1');

      const result = repo.findById('t-1');
      expect(result).toBeUndefined();
    });
  });
});
