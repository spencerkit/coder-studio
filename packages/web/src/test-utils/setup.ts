/**
 * Test Setup
 *
 * Global setup for vitest with testing-library.
 */

import "@testing-library/jest-dom";

if (typeof window !== "undefined") {
  if (
    !window.localStorage ||
    typeof window.localStorage.getItem !== "function" ||
    typeof window.localStorage.setItem !== "function"
  ) {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, String(value));
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        get length() {
          return storage.size;
        },
      },
    });
  }
}

// ResizeObserver polyfill for jsdom
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverPolyfill;

// WebSocket mock for jsdom
class WebSocketMock {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = WebSocketMock.OPEN;

  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

global.WebSocket = WebSocketMock as unknown as typeof WebSocket;

// DOM API mocks for jsdom
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.focus = () => {};
}

if (typeof document !== "undefined") {
  document.queryCommandSupported = () => false;
}
