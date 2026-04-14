import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  generateBridgeScript,
  deployBridgeScript,
  getBridgeScriptPath,
  HOOKS_BRIDGE_DIR,
} from './bridge.js';

describe('bridge', () => {
  const testHooksDir = HOOKS_BRIDGE_DIR;

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testHooksDir)) {
      rmSync(testHooksDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testHooksDir)) {
      rmSync(testHooksDir, { recursive: true });
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
  });

  describe('deployBridgeScript', () => {
    it('should create hooks directory if it does not exist', () => {
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
      expect(path).toBe(join(homedir(), '.coder-studio', 'hooks', 'claude-bridge.js'));
    });

    it('should return different paths for different providers', () => {
      const claudePath = getBridgeScriptPath('claude');
      const codexPath = getBridgeScriptPath('codex');

      expect(claudePath).not.toBe(codexPath);
    });
  });
});
