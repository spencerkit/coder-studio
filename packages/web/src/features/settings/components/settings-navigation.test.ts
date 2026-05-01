import { describe, expect, it } from 'vitest';
import { resolveSettingsExitTarget } from './settings-navigation';

describe('resolveSettingsExitTarget', () => {
  it('returns history when the router history index is greater than zero', () => {
    expect(
      resolveSettingsExitTarget({
        historyIndex: 2,
        historyLength: 3,
        hasActiveWorkspace: true,
      })
    ).toBe('history');
  });

  it('falls back to /workspace when no prior history exists but a workspace is active', () => {
    expect(
      resolveSettingsExitTarget({
        historyIndex: 0,
        historyLength: 1,
        hasActiveWorkspace: true,
      })
    ).toBe('/workspace');
  });

  it('falls back to / when no prior history exists and no workspace is active', () => {
    expect(
      resolveSettingsExitTarget({
        historyIndex: 0,
        historyLength: 1,
        hasActiveWorkspace: false,
      })
    ).toBe('/');
  });
});
