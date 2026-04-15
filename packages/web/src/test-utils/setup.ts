/**
 * Test Setup
 *
 * Global setup for vitest with testing-library.
 */

import '@testing-library/jest-dom';

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