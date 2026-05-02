import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { createServer } from 'http';
import { spawnSync } from 'child_process';
import {
  generateBridgeScript,
  deployBridgeScript,
  getBridgeScriptPath,
  getHooksBridgeDir,
} from './bridge.js';

describe('bridge', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-bridge-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;

    const testHooksDir = getHooksBridgeDir();
    if (existsSync(testHooksDir)) {
      rmSync(testHooksDir, { recursive: true });
    }
  });

  afterEach(() => {
    const testHooksDir = getHooksBridgeDir();
    if (existsSync(testHooksDir)) {
      rmSync(testHooksDir, { recursive: true });
    }

    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  describe('generateBridgeScript', () => {
    it('should generate valid JavaScript for a provider', () => {
      const script = generateBridgeScript('claude');

      expect(script).toContain('const event = process.argv[2]');
      expect(script).toContain('runtime.json');
      expect(script).toContain('/internal/hooks/');
      expect(script).toContain('process.exit(0)');
    });

    it('should include provider ID in comment', () => {
      const script = generateBridgeScript('claude');
      expect(script).toContain('Coder Studio hook bridge for claude');
    });

    it('should generate different scripts for different providers', () => {
      const claudeScript = generateBridgeScript('claude');
      const codexScript = generateBridgeScript('codex');

      expect(claudeScript).not.toBe(codexScript);
      expect(claudeScript).toContain('claude');
      expect(codexScript).toContain('codex');
    });

    it('should post Codex events using payload.type instead of the raw argv JSON', async () => {
      const tempHome = mkdtempSync(join(tmpdir(), 'cs-codex-bridge-'));
      const runtimeDir = join(tempHome, '.coder-studio');
      mkdirSync(runtimeDir, { recursive: true });

      const requestPromise = new Promise<{ url: string; body: unknown }>((resolve) => {
        const server = createServer((req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            resolve({
              url: req.url || '',
              body: JSON.parse(body || '{}'),
            });
            server.close();
          });
        });

        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            throw new Error('Failed to resolve bridge test server address');
          }

          writeFileSync(
            join(runtimeDir, 'runtime.json'),
            JSON.stringify({
              host: '127.0.0.1',
              port: address.port,
              pid: process.pid,
              token: 'test-token',
              serverInstanceId: 'bridge-test',
              startedAt: Date.now(),
            }),
            'utf-8'
          );

          const scriptPath = join(tempHome, 'codex-bridge.js');
          writeFileSync(scriptPath, generateBridgeScript('codex'), 'utf-8');

          const payload = {
            type: 'agent-turn-complete',
            'thread-id': 'thread-1',
            'turn-id': 'turn-1',
          };

          spawnSync(process.execPath, [scriptPath, JSON.stringify(payload)], {
            env: {
              ...process.env,
              HOME: tempHome,
              CODER_STUDIO_SESSION_ID: 'sess-bridge-1',
            },
            stdio: 'ignore',
          });
        });
      });

      const request = await requestPromise;
      expect(request.url).toBe(
        '/internal/hooks/agent-turn-complete?token=test-token&coder_studio_session_id=sess-bridge-1'
      );
      expect(request.body).toEqual({
        type: 'agent-turn-complete',
        'thread-id': 'thread-1',
        'turn-id': 'turn-1',
      });

      rmSync(tempHome, { recursive: true, force: true });
    });
  });

  describe('deployBridgeScript', () => {
    it('should create hooks directory if it does not exist', () => {
      const testHooksDir = getHooksBridgeDir();
      expect(existsSync(testHooksDir)).toBe(false);

      deployBridgeScript('claude');

      expect(existsSync(testHooksDir)).toBe(true);
    });

    it('should write bridge script to disk', () => {
      deployBridgeScript('claude');

      const scriptPath = getBridgeScriptPath('claude');
      expect(existsSync(scriptPath)).toBe(true);

      const content = readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('claude');
    });

    it('should not rewrite if content has not changed', () => {
      // First deployment
      deployBridgeScript('claude');
      const scriptPath = getBridgeScriptPath('claude');
      const firstContent = readFileSync(scriptPath, 'utf-8');
      const firstMtime = existsSync(scriptPath) ?
        require('fs').statSync(scriptPath).mtimeMs : 0;

      // Wait a bit
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Second deployment (should skip write)
      deployBridgeScript('claude');
      const secondMtime = existsSync(scriptPath) ?
        require('fs').statSync(scriptPath).mtimeMs : 0;

      // mtime should be the same (no write occurred)
      expect(secondMtime).toBe(firstMtime);
    });

    it('should update if content has changed', () => {
      // Deploy for provider 'claude'
      deployBridgeScript('claude');
      const scriptPath = getBridgeScriptPath('claude');
      const firstContent = readFileSync(scriptPath, 'utf-8');

      // Manually modify the file
      const modifiedContent = firstContent.replace('claude', 'modified');
      require('fs').writeFileSync(scriptPath, modifiedContent, 'utf-8');

      // Redeploy (should detect change and rewrite)
      deployBridgeScript('claude');
      const finalContent = readFileSync(scriptPath, 'utf-8');

      expect(finalContent).toContain('claude');
      expect(finalContent).not.toBe(modifiedContent);
    });
  });

  describe('getBridgeScriptPath', () => {
    it('should return correct path for provider', () => {
      const path = getBridgeScriptPath('claude');
      expect(path).toBe(join(testHomeDir, '.coder-studio', 'hooks', 'claude-bridge.js'));
    });

    it('should return different paths for different providers', () => {
      const claudePath = getBridgeScriptPath('claude');
      const codexPath = getBridgeScriptPath('codex');

      expect(claudePath).not.toBe(codexPath);
    });
  });
});
