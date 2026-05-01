import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewport } from './use-viewport';

type MQListener = (event: { matches: boolean }) => void;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: (type: 'change', listener: MQListener) => void;
  removeEventListener: (type: 'change', listener: MQListener) => void;
  trigger: (matches: boolean) => void;
}

function createMatchMediaMock(initialMatches: (query: string) => boolean) {
  const lists = new Map<string, MockMediaQueryList>();

  const matchMedia = vi.fn((query: string) => {
    if (lists.has(query)) {
      return lists.get(query)!;
    }

    const listeners = new Set<MQListener>();
    const list: MockMediaQueryList = {
      matches: initialMatches(query),
      media: query,
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
      trigger: (matches: boolean) => {
        list.matches = matches;
        for (const listener of listeners) {
          listener({ matches });
        }
      },
    };

    lists.set(query, list);
    return list;
  });

  return { lists, matchMedia };
}

describe('useViewport', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns "desktop" when viewport is wide and pointer is fine', () => {
    const { matchMedia } = createMatchMediaMock(() => false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('desktop');
  });

  it('returns "mobile" when viewport is narrow', () => {
    const { matchMedia } = createMatchMediaMock((query) => query.includes('max-width: 899px'));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('mobile');
  });

  it('returns "desktop" when pointer is coarse but viewport is wide', () => {
    const { matchMedia } = createMatchMediaMock((query) => query.includes('pointer: coarse'));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('desktop');
  });

  it('updates reactively when the viewport query changes', () => {
    const { lists, matchMedia } = createMatchMediaMock(() => false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('desktop');

    act(() => {
      lists.get('(max-width: 899px)')!.trigger(true);
    });

    expect(result.current).toBe('mobile');
  });

  it('cleans up listeners on unmount', () => {
    const { lists, matchMedia } = createMatchMediaMock(() => false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { unmount } = renderHook(() => useViewport());
    const widthList = lists.get('(max-width: 899px)')!;
    const widthRemove = vi.spyOn(widthList, 'removeEventListener');

    unmount();

    expect(widthRemove).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
