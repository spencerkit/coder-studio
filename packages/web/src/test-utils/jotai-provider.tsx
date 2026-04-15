/**
 * Test Utilities
 *
 * Helper components and functions for testing with Jotai.
 */

import { ReactNode } from 'react';
import { Provider } from 'jotai';

/**
 * Jotai Provider for tests
 * Provides a fresh atom store for each test
 */
export function JotaiProvider({ children }: { children: ReactNode }) {
  return <Provider>{children}</Provider>;
}