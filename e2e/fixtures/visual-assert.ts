import { expect, Locator } from '@playwright/test';

/**
 * Asserts that a locator matches a baseline screenshot.
 * Uses strict pixel ratio tolerance for visual regression testing.
 */
export async function assertBaseline(locator: Locator, snapshotName: string) {
  await expect(locator).toHaveScreenshot(snapshotName, {
    maxDiffPixelRatio: 0.001,
  });
}
