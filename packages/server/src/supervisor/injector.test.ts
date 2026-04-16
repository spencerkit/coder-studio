import { describe, it, expect, vi } from 'vitest';
import { injectGuidance } from './injector.js';
import type { TerminalManager } from '../terminal/manager.js';

describe('injectGuidance', () => {
  it('writes guidance text to the session terminal', async () => {
    const mockWrite = vi.fn();
    const mockTerminalMgr = {
      writeToSession: mockWrite,
    } as unknown as TerminalManager;

    await injectGuidance(mockTerminalMgr, 'session-1', 'Focus on error handling');

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('Focus on error handling')
    );
  });

  it('formats guidance with supervisor prefix', async () => {
    const mockWrite = vi.fn();
    const mockTerminalMgr = {
      writeToSession: mockWrite,
    } as unknown as TerminalManager;

    await injectGuidance(mockTerminalMgr, 'session-1', 'Fix the bug');

    const writtenText = mockWrite.mock.calls[0][1] as string;
    expect(writtenText).toContain('[Supervisor]');
    expect(writtenText).toContain('Fix the bug');
  });
});