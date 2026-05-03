import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditCodexConfigToml,
  cleanupCodexConfigToml,
} from './codex-config-audit.js';

describe('codex-config-audit', () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cs-codex-audit-'));
    configPath = join(tmp, 'config.toml');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns exists:false when config.toml is missing', () => {
    const audit = auditCodexConfigToml(join(tmp, 'nope.toml'));
    expect(audit.exists).toBe(false);
    expect(audit.findings).toEqual([]);
  });

  it('returns no findings for a clean config', () => {
    writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        'model_provider = "custom"',
        '',
        '[features]',
        'apps = false',
        '',
        '[history]',
        'persistence = "none"',
      ].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    expect(audit.exists).toBe(true);
    expect(audit.findings).toEqual([]);
  });

  it('detects single-line top-level notify', () => {
    writeFileSync(
      configPath,
      ['model = "gpt-5"', 'notify = ["agent-notify", "codex"]', ''].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]).toMatchObject({
      id: 'toml_notify',
      severity: 'warn',
      startLine: 2,
      endLine: 2,
    });
  });

  it('detects multi-line top-level notify with bracketed block', () => {
    const content = [
      'model = "gpt-5.3-codex"',
      'service_tier = "fast"',
      '',
      'notify = [',
      '    "agent-notify",',
      '    "codex",',
      ']',
      '',
      '[features]',
      'apps = false',
    ].join('\n');
    writeFileSync(configPath, content);

    const audit = auditCodexConfigToml(configPath);
    expect(audit.findings).toHaveLength(1);
    const f = audit.findings[0]!;
    expect(f.id).toBe('toml_notify');
    expect(f.startLine).toBe(4);
    expect(f.endLine).toBe(7);
    expect(f.snippet).toContain('agent-notify');
    expect(f.snippet).toContain(']');
  });

  it('detects [features] codex_hooks = true', () => {
    writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        '',
        '[features]',
        'apps = false',
        'codex_hooks = true',
      ].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]).toMatchObject({
      id: 'toml_codex_hooks',
      severity: 'info',
      startLine: 5,
      endLine: 5,
    });
  });

  it('does NOT flag codex_hooks = false', () => {
    writeFileSync(
      configPath,
      ['[features]', 'codex_hooks = false'].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    expect(audit.findings).toEqual([]);
  });

  it('does NOT flag codex_hooks = true outside [features]', () => {
    writeFileSync(
      configPath,
      ['[other]', 'codex_hooks = true'].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    expect(audit.findings).toEqual([]);
  });

  it('does NOT flag notify inside a [section]', () => {
    writeFileSync(
      configPath,
      ['[some_section]', 'notify = ["x"]'].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    expect(audit.findings).toEqual([]);
  });

  it('detects both notify and codex_hooks in one pass', () => {
    writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        'notify = ["agent-notify"]',
        '',
        '[features]',
        'codex_hooks = true',
      ].join('\n')
    );
    const audit = auditCodexConfigToml(configPath);
    const ids = audit.findings.map((f) => f.id).sort();
    expect(ids).toEqual(['toml_codex_hooks', 'toml_notify']);
  });

  it('cleanup is a no-op when nothing is selected', () => {
    writeFileSync(configPath, 'notify = ["x"]\n');
    const result = cleanupCodexConfigToml(configPath, { removeIds: [] });
    expect(result.noop).toBe(true);
    expect(result.removed).toEqual([]);
    expect(readFileSync(configPath, 'utf-8')).toBe('notify = ["x"]\n');
  });

  it('cleanup removes only selected findings, leaves others alone', () => {
    const before = [
      'model = "gpt-5"',
      'notify = ["agent-notify", "codex"]',
      '',
      '[features]',
      'codex_hooks = true',
      '',
    ].join('\n');
    writeFileSync(configPath, before);

    const result = cleanupCodexConfigToml(configPath, {
      removeIds: ['toml_notify'],
    });
    expect(result.removed).toEqual(['toml_notify']);
    expect(result.backupPath).toBeTruthy();
    expect(existsSync(result.backupPath!)).toBe(true);

    const after = readFileSync(configPath, 'utf-8');
    expect(after).not.toContain('notify = [');
    expect(after).toContain('codex_hooks = true');
    expect(after).toContain('[features]');
    expect(after).toContain('model = "gpt-5"');
  });

  it('cleanup preserves comments and unrelated sections byte-for-byte', () => {
    const before = [
      '# My Codex config',
      'model = "gpt-5"  # preferred model',
      '',
      '# --- legacy notify, remove me ---',
      'notify = [',
      '    "agent-notify",',
      '    "codex",',
      ']',
      '',
      '[projects."/home/spencer"]',
      'trust_level = "trusted"',
      '',
    ].join('\n');
    writeFileSync(configPath, before);

    const result = cleanupCodexConfigToml(configPath, {
      removeIds: ['toml_notify'],
    });
    expect(result.removed).toEqual(['toml_notify']);

    const after = readFileSync(configPath, 'utf-8');
    expect(after).toContain('# My Codex config');
    expect(after).toContain('# preferred model');
    expect(after).toContain('# --- legacy notify, remove me ---');
    expect(after).toContain('[projects."/home/spencer"]');
    expect(after).toContain('trust_level = "trusted"');
    expect(after).not.toContain('notify = [');
    expect(after).not.toContain('"agent-notify"');
  });

  it('cleanup is idempotent — second run is noop', () => {
    writeFileSync(configPath, 'notify = ["x"]\n');
    const first = cleanupCodexConfigToml(configPath, {
      removeIds: ['toml_notify'],
    });
    expect(first.removed).toEqual(['toml_notify']);

    const second = cleanupCodexConfigToml(configPath, {
      removeIds: ['toml_notify'],
    });
    expect(second.noop).toBe(true);
    expect(second.removed).toEqual([]);
  });

  it('cleanup writes a timestamped backup next to the config by default', () => {
    writeFileSync(configPath, 'notify = ["x"]\n');
    cleanupCodexConfigToml(configPath, { removeIds: ['toml_notify'] });
    const files = readdirSync(tmp).filter((f) => f.startsWith('config.bak.'));
    expect(files).toHaveLength(1);
  });

  it('cleanup against a missing file reports noop, no throw', () => {
    const result = cleanupCodexConfigToml(join(tmp, 'nope.toml'), {
      removeIds: ['toml_notify'],
    });
    expect(result.noop).toBe(true);
    expect(result.removed).toEqual([]);
  });
});
