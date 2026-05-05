/**
 * Test Utilities
 *
 * Helper components and functions for testing with Jotai.
 */

import { Provider } from "jotai";
import { ReactNode } from "react";

/**
 * Jotai Provider for tests
 * Provides a fresh atom store for each test
 */
export function JotaiProvider({ children }: { children: ReactNode }) {
  return <Provider>{children}</Provider>;
}
