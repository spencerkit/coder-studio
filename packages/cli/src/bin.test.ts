import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerStatus,
  readCliConfig,
  startManagedServer,
  startServer,
  stopRunningServer,
  writeCliConfig,
} = vi.hoisted(() => ({
  getServerStatus: vi.fn(),
  readCliConfig: vi.fn(),
  startManagedServer: vi.fn(),
  startServer: vi.fn(),
  stopRunningServer: vi.fn(),
  writeCliConfig: vi.fn(),
}));

vi.mock('./config-store.js', () => ({
  readCliConfig,
  writeCliConfig,
}));

vi.mock('./pm2-control.js', () => ({
  startManagedServer,
}));

vi.mock('./server-control.js', () => ({
  getServerStatus,
  stopRunningServer,
}));

vi.mock('./server-runner.js', () => ({
  startServer,
}));

import { main } from './bin';
import { parseArgs, RUNTIME_CONFIG_ERROR } from './parse-args';

beforeEach(() => {
  readCliConfig.mockReturnValue(null);
  writeCliConfig.mockImplementation(() => undefined);
  startManagedServer.mockResolvedValue(undefined);
  startServer.mockResolvedValue({ stop: vi.fn() });
  stopRunningServer.mockResolvedValue(false);
  getServerStatus.mockResolvedValue({
    status: 'stopped',
    pid: null,
    port: null,
    restartCount: 0,
    outFile: '/tmp/server.out.log',
    errFile: '/tmp/server.err.log',
    startedAt: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('main', () => {
  it('runs the foreground runner when serve --foreground is provided', async () => {
    await main(['serve', '--foreground']);

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startManagedServer).not.toHaveBeenCalled();
  });

  it('starts pm2-managed mode for bare serve', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main(['serve']);

    expect(startManagedServer).toHaveBeenCalledWith({
      script: expect.stringMatching(/server-runner\.(ts|js|mjs)$/),
      cwd: process.cwd(),
      waitMs: 5000,
    });
    expect(logSpy).toHaveBeenCalledWith('Coder Studio server started in background.');
    expect(logSpy).toHaveBeenCalledWith('Run `coder-studio status` to inspect the server.');
  });

  it('prints status output for status command', async () => {
    getServerStatus.mockResolvedValue({
      status: 'running',
      pid: 424242,
      port: 4187,
      restartCount: 2,
      outFile: '/tmp/server.out.log',
      errFile: '/tmp/server.err.log',
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main(['status']);

    const output = logSpy.mock.calls[0]?.[0];
    expect(output).toContain('Status: running');
    expect(output).toContain('4187');
  });

  it('prints combined log output for logs command', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'cs-cli-logs-'));
    const outFile = join(logDir, 'server.out.log');
    const errFile = join(logDir, 'server.err.log');
    writeFileSync(outFile, 'out line\n', 'utf-8');
    writeFileSync(errFile, 'err line\n', 'utf-8');
    getServerStatus.mockResolvedValue({
      status: 'running',
      pid: 424242,
      port: 4187,
      restartCount: 2,
      outFile,
      errFile,
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await main(['logs']);
      expect(logSpy).toHaveBeenCalledWith('out line\nerr line');
    } finally {
      if (existsSync(logDir)) {
        rmSync(logDir, { recursive: true, force: true });
      }
    }
  });

  it('prints stop output for stop command', async () => {
    stopRunningServer.mockResolvedValue(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main(['stop']);

    expect(logSpy).toHaveBeenCalledWith('Stopped Coder Studio server.');
  });

  it('drops an ephemeral port when config updates rewrite saved settings', async () => {
    readCliConfig.mockReturnValue({
      host: '0.0.0.0',
      port: 0,
      dataDir: '/tmp/cs-data/coder-studio.db',
      password: 'sekrit',
    });

    await main(['config', '--host', '127.0.0.1']);

    expect(writeCliConfig).toHaveBeenCalledWith({
      host: '127.0.0.1',
      dataDir: '/tmp/cs-data/coder-studio.db',
      password: 'sekrit',
    });
  });
});

describe('parseArgs', () => {
  it('defaults to serve command when no command given', () => {
    expect(parseArgs([])).toEqual({
      command: 'serve',
    });
  });

  it('parses config command with host and port values', () => {
    expect(parseArgs(['config', '--host', '0.0.0.0', '--port', '4186'])).toEqual({
      command: 'config',
      host: '0.0.0.0',
      port: 4186,
    });
  });

  it('parses config command with data-dir and password values', () => {
    expect(parseArgs(['config', '--data-dir', '/tmp/cs-data', '--password', 'sekrit'])).toEqual({
      command: 'config',
      dataDir: '/tmp/cs-data',
      password: 'sekrit',
    });
  });

  it('parses stop command', () => {
    expect(parseArgs(['stop'])).toEqual({
      command: 'stop',
    });
  });

  it('parses status command', () => {
    expect(parseArgs(['status'])).toEqual({
      command: 'status',
    });
  });

  it('parses logs command', () => {
    expect(parseArgs(['logs'])).toEqual({
      command: 'logs',
    });
  });

  it('treats -h as help instead of host', () => {
    expect(parseArgs(['-h'])).toEqual({
      command: 'help',
    });
  });

  it('parses config help subcommand', () => {
    expect(parseArgs(['config', 'help'])).toEqual({
      command: 'config',
      configHelp: true,
    });
  });

  it('parses config --help flag', () => {
    expect(parseArgs(['config', '--help'])).toEqual({
      command: 'config',
      configHelp: true,
    });
  });

  it('parses serve --foreground with foreground: true', () => {
    expect(parseArgs(['serve', '--foreground'])).toEqual({
      command: 'serve',
      foreground: true,
    });
  });

  it('parses bare foreground flag as serve foreground mode', () => {
    expect(parseArgs(['--foreground'])).toEqual({
      command: 'serve',
      foreground: true,
    });
  });

  it('rejects serve-time host overrides', () => {
    expect(() => parseArgs(['serve', '--host', '0.0.0.0'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects serve-time port overrides', () => {
    expect(() => parseArgs(['serve', '--port', '4186'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects serve-time data-dir overrides', () => {
    expect(() => parseArgs(['serve', '--data-dir', '/tmp/data'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects bare data-dir overrides', () => {
    expect(() => parseArgs(['--data-dir', '/tmp/cs-data'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects serve-time password overrides', () => {
    expect(() => parseArgs(['serve', '--password', 'sekrit'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects bare password overrides', () => {
    expect(() => parseArgs(['--password', 'sekrit'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects serve-time no-auth overrides', () => {
    expect(() => parseArgs(['serve', '--no-auth'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects bare no-auth overrides', () => {
    expect(() => parseArgs(['--no-auth'])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it('rejects status-time host overrides', () => {
    expect(() => parseArgs(['status', '--host', '0.0.0.0'])).toThrow('Unknown option: --host');
  });

  it('rejects logs-time port overrides', () => {
    expect(() => parseArgs(['logs', '--port', '4186'])).toThrow('Unknown option: --port');
  });

  it('rejects stop-time data-dir overrides', () => {
    expect(() => parseArgs(['stop', '--data-dir', '/tmp/cs-data'])).toThrow('Unknown option: --data-dir');
  });

  it('rejects help-time password overrides', () => {
    expect(() => parseArgs(['help', '--password', 'sekrit'])).toThrow('Unknown option: --password');
  });

  it('rejects version-time no-auth overrides', () => {
    expect(() => parseArgs(['--version', '--no-auth'])).toThrow('Unknown option: --no-auth');
  });

  it('rejects config-to-stop host overrides after switching commands', () => {
    expect(() => parseArgs(['config', 'stop', '--host', '0.0.0.0'])).toThrow('Unknown option: --host');
  });

  it('rejects config-to-status password overrides after switching commands', () => {
    expect(() => parseArgs(['config', 'status', '--password', 'sekrit'])).toThrow('Unknown option: --password');
  });

  it('rejects config-to-logs no-auth overrides after switching commands', () => {
    expect(() => parseArgs(['config', 'logs', '--no-auth'])).toThrow('Unknown option: --no-auth');
  });

  it('rejects config-time no-auth overrides', () => {
    expect(() => parseArgs(['config', '--no-auth'])).toThrow('Unknown option: --no-auth');
  });

  it('treats config then stop then help as help, not config help', () => {
    expect(parseArgs(['config', 'stop', 'help'])).toEqual({
      command: 'help',
    });
  });

  it('treats config then logs then --help as help, not config help', () => {
    expect(parseArgs(['config', 'logs', '--help'])).toEqual({
      command: 'help',
    });
  });

  it('rejects foreground after switching from serve to version', () => {
    expect(() => parseArgs(['serve', '--version', '--foreground'])).toThrow('Unknown option: --foreground');
  });

  it('rejects unknown positional tokens', () => {
    expect(() => parseArgs(['bogus'])).toThrow('Unknown argument: bogus');
  });

  it('rejects unknown flags on non-config commands', () => {
    expect(() => parseArgs(['status', '--bogus'])).toThrow('Unknown option: --bogus');
  });

  it('allows config-time host-only updates', () => {
    expect(parseArgs(['config', '--host', '127.0.0.1'])).toEqual({
      command: 'config',
      host: '127.0.0.1',
    });
  });

  it('allows config-time port-only updates', () => {
    expect(parseArgs(['config', '--port', '4190'])).toEqual({
      command: 'config',
      port: 4190,
    });
  });

  it('allows config-time data-dir updates', () => {
    expect(parseArgs(['config', '--data-dir', '/custom/path'])).toEqual({
      command: 'config',
      dataDir: '/custom/path',
    });
  });

  it('allows config-time password updates', () => {
    expect(parseArgs(['config', '--password', 'mypassword'])).toEqual({
      command: 'config',
      password: 'mypassword',
    });
  });
});
