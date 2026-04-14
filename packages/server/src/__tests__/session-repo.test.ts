import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openDatabase,
  closeDatabase,
  SessionRepo,
  TerminalRepo,
  WorkspaceRepo,
  type NewSession,
  type NewTerminal,
  type NewWorkspace,
} from '../storage/index.js';
import type { Database } from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('SessionRepo', () => {
  let db: Database;
  let repo: SessionRepo;
  let terminalRepo: TerminalRepo;
  let workspaceRepo: WorkspaceRepo;
  let tempDir: string;
  let testWorkspace: NewWorkspace;
  let testTerminal: NewTerminal;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-repo-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = openDatabase(dbPath);
    repo = new SessionRepo(db);
    terminalRepo = new TerminalRepo(db);
    workspaceRepo = new WorkspaceRepo(db);

    // Create test workspace and terminal
    testWorkspace = {
      id: 'ws-1',
      path: '/path/to/workspace',
      targetRuntime: 'native',
      openedAt: Date.now(),
      lastActiveAt: Date.now(),
      uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
    };
    workspaceRepo.create(testWorkspace);

    testTerminal = {
      id: 't-1',
      workspaceId: 'ws-1',
      kind: 'agent',
      cwd: '/path/to/workspace',
      argv: ['node', 'server.js'],
      cols: 80,
      rows: 24,
      createdAt: Date.now(),
    };
    terminalRepo.create(testTerminal);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a new session', () => {
      const newSession: NewSession = {
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      const result = repo.create(newSession);

      expect(result.id).toBe(newSession.id);
      expect(result.workspaceId).toBe(newSession.workspaceId);
      expect(result.terminalId).toBe(newSession.terminalId);
      expect(result.providerId).toBe('claude-cli');
      expect(result.state).toBe('running');
      expect(result.capability).toBe('full');
    });

    it('should create a session with resume_id and completion percent', () => {
      const newSession: NewSession = {
        id: 's-2',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        resumeId: 'resume-123',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        completionPercent: 50,
      };

      const result = repo.create(newSession);

      expect(result.resumeId).toBe('resume-123');
      expect(result.completionPercent).toBe(50);
    });
  });

  describe('listByWorkspace', () => {
    it('should list all sessions for a workspace', () => {
      // Create additional terminal for second session
      terminalRepo.create({
        id: 't-2',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: 1000,
        lastActiveAt: 1000,
      });

      repo.create({
        id: 's-2',
        workspaceId: 'ws-1',
        terminalId: 't-2',
        providerId: 'claude-cli',
        state: 'idle',
        capability: 'limited',
        startedAt: 2000,
        lastActiveAt: 2000,
      });

      const sessions = repo.listByWorkspace('ws-1');

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.id)).toEqual(expect.arrayContaining(['s-1', 's-2']));
    });

    it('should return empty array for workspace with no sessions', () => {
      const sessions = repo.listByWorkspace('ws-1');
      expect(sessions).toHaveLength(0);
    });
  });

  describe('listActiveByWorkspace', () => {
    it('should list only active (non-ended) sessions', () => {
      // Create additional terminal for second session
      terminalRepo.create({
        id: 't-2',
        workspaceId: 'ws-1',
        kind: 'agent',
        cwd: '/path',
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.create({
        id: 's-2',
        workspaceId: 'ws-1',
        terminalId: 't-2',
        providerId: 'claude-cli',
        state: 'ended',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      // Mark one as ended
      repo.markEnded('s-2', Date.now());

      const active = repo.listActiveByWorkspace('ws-1');

      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('s-1');
    });
  });

  describe('findById', () => {
    it('should find a session by ID', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      const result = repo.findById('s-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('s-1');
    });

    it('should return undefined for non-existent session', () => {
      const result = repo.findById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('findByTerminalId', () => {
    it('should find a session by terminal ID', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      const result = repo.findByTerminalId('t-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('s-1');
    });
  });

  describe('updateState', () => {
    it('should update session state', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'starting',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.updateState('s-1', 'running');

      const result = repo.findById('s-1');
      expect(result?.state).toBe('running');
    });
  });

  describe('updateResumeId', () => {
    it('should update resume_id', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.updateResumeId('s-1', 'new-resume-id');

      const result = repo.findById('s-1');
      expect(result?.resumeId).toBe('new-resume-id');
    });
  });

  describe('updateLastActive', () => {
    it('should update last active timestamp', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: 1000,
        lastActiveAt: 1000,
      });

      const newTime = Date.now();
      repo.updateLastActive('s-1', newTime);

      const result = repo.findById('s-1');
      expect(result?.lastActiveAt).toBe(newTime);
    });
  });

  describe('markEnded', () => {
    it('should mark a session as ended', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      const endedAt = Date.now();
      repo.markEnded('s-1', endedAt);

      const result = repo.findById('s-1');
      expect(result?.endedAt).toBe(endedAt);
      expect(result?.state).toBe('ended');
    });
  });

  describe('updateCompletionPercent', () => {
    it('should update completion percent', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        completionPercent: 30,
      });

      repo.updateCompletionPercent('s-1', 75);

      const result = repo.findById('s-1');
      expect(result?.completionPercent).toBe(75);
    });
  });

  describe('setError', () => {
    it('should set error reason', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.setError('s-1', 'API rate limit exceeded');

      const result = repo.findById('s-1');
      expect(result?.errorReason).toBe('API rate limit exceeded');
    });
  });

  describe('archive', () => {
    it('should archive a session', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'ended',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.archive('s-1');

      const row = db.prepare('SELECT archived FROM sessions WHERE id = ?').get('s-1') as { archived: number };
      expect(row.archived).toBe(1);
    });
  });

  describe('delete', () => {
    it('should delete a session by ID', () => {
      repo.create({
        id: 's-1',
        workspaceId: 'ws-1',
        terminalId: 't-1',
        providerId: 'claude-cli',
        state: 'running',
        capability: 'full',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.delete('s-1');

      const result = repo.findById('s-1');
      expect(result).toBeUndefined();
    });
  });
});
