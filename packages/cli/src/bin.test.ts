import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse-args';

describe('parseArgs', () => {
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

  it('rejects serve-time host overrides', () => {
    expect(() => parseArgs(['serve', '--host', '0.0.0.0'])).toThrow(
      'Host and port must be configured via the config command'
    );
  });

  it('rejects serve-time port overrides', () => {
    expect(() => parseArgs(['serve', '--port', '4186'])).toThrow(
      'Host and port must be configured via the config command'
    );
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
});
