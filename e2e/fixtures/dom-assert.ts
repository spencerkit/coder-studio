import { expect, Page } from "@playwright/test";

/**
 * Asserts that a DOM element uses a specific CSS custom property (token) value.
 */
export async function assertUsesToken(
  page: Page,
  selector: string,
  property: string,
  expected: string
) {
  const value = await page.locator(selector).evaluate((el, prop) => {
    return getComputedStyle(el).getPropertyValue(prop).trim();
  }, property);
  expect(value).toBe(expected);
}
