import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatProviderLabel,
  formatWorkspaceLabel,
  sanitizeInlineText,
  stripAnsi,
  stripAnsiChunk,
  summarizeOutput,
} from './format';

describe('stripAnsi', () => {
  it('removes SGR colour sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text');
  });

  it('removes cursor / clear sequences', () => {
    expect(stripAnsi('foo\x1b[2Kbar\x1b[1A')).toBe('foobar');
  });

  it('removes OSC sequences (e.g. window title)', () => {
    expect(stripAnsi('hello\x1b]0;my title\x07world')).toBe('helloworld');
  });

  it('drops bell, backspace, and stray carriage returns but keeps newlines and tabs', () => {
    expect(stripAnsi('a\x07b\x08c\rd\n\te')).toBe('abcd\n\te');
  });

  it('drops dangling incomplete escape sequences at the end of the buffer', () => {
    expect(stripAnsi('hello\x1b[31')).toBe('hello');
    expect(stripAnsi('hello\x1b]0;title')).toBe('hello');
  });

  it('removes ST-terminated control string payloads', () => {
    expect(stripAnsi('\x1bP1;2|hidden\x1b\\shown')).toBe('shown');
    expect(stripAnsi('\x1b_secret\x1b\\shown')).toBe('shown');
  });

  it('returns empty string for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('stripAnsiChunk', () => {
  it('carries incomplete ANSI sequences across chunk boundaries', () => {
    const first = stripAnsiChunk('\x1b[32');
    expect(first).toEqual({ cleaned: '', carry: '\x1b[32' });

    const second = stripAnsiChunk('mhello\x1b[0m\n', first.carry);
    expect(second).toEqual({ cleaned: 'hello\n', carry: '' });
  });
});

describe('sanitizeInlineText', () => {
  it('strips ANSI/control bytes and collapses whitespace for inline labels', () => {
    expect(sanitizeInlineText(' \x1b[32mDemo\t\tApp\x1b[0m \n')).toBe('Demo App');
  });
});

describe('summarizeOutput', () => {
  it('returns the last non-empty line, whitespace-collapsed', () => {
    expect(summarizeOutput('first line\n\nfinal   answer  here')).toBe('final answer here');
  });

  it('skips lines that look like a bare prompt marker', () => {
    expect(summarizeOutput('the answer is 42\n>')).toBe('the answer is 42');
    expect(summarizeOutput('done\n❯')).toBe('done');
  });

  it('truncates beyond maxChars with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const result = summarizeOutput(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string when no usable content', () => {
    expect(summarizeOutput('')).toBe('');
    expect(summarizeOutput('\n\n\n')).toBe('');
    expect(summarizeOutput('>\n>\n>')).toBe('');
  });
});

describe('formatProviderLabel', () => {
  it('maps known providers to canonical names', () => {
    expect(formatProviderLabel('claude')).toBe('Claude');
    expect(formatProviderLabel('codex')).toBe('Codex');
  });

  it('title-cases unknown providers', () => {
    expect(formatProviderLabel('aider')).toBe('Aider');
  });

  it('falls back to "Agent" for empty input', () => {
    expect(formatProviderLabel('')).toBe('Agent');
  });
});

describe('formatWorkspaceLabel', () => {
  it('prefers the explicit name', () => {
    expect(formatWorkspaceLabel({ name: 'My Project', path: '/tmp/foo' })).toBe('My Project');
  });

  it('falls back to the basename of the path', () => {
    expect(formatWorkspaceLabel({ path: '/home/spencer/workspace/coder-studio' })).toBe('coder-studio');
  });

  it('handles trailing slashes and Windows-style separators', () => {
    expect(formatWorkspaceLabel({ path: '/tmp/foo/' })).toBe('foo');
    expect(formatWorkspaceLabel({ path: 'C:\\Users\\me\\proj\\' })).toBe('proj');
  });

  it('returns empty string for missing workspace', () => {
    expect(formatWorkspaceLabel(null)).toBe('');
    expect(formatWorkspaceLabel(undefined)).toBe('');
    expect(formatWorkspaceLabel({})).toBe('');
  });
});

describe('formatDuration', () => {
  it('shows <1s for sub-second durations', () => {
    expect(formatDuration(0)).toBe('<1s');
    expect(formatDuration(400)).toBe('<1s');
    expect(formatDuration(999)).toBe('<1s');
  });

  it('shows seconds under one minute', () => {
    expect(formatDuration(1_000)).toBe('1s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('shows minutes (with optional seconds) under one hour', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(59 * 60_000)).toBe('59m');
  });

  it('shows hours and minutes for longer durations', () => {
    expect(formatDuration(60 * 60_000)).toBe('1h 0m');
    expect(formatDuration(3_905_000)).toBe('1h 5m');
  });

  it('returns empty for invalid input', () => {
    expect(formatDuration(NaN)).toBe('');
    expect(formatDuration(-100)).toBe('');
  });
});
