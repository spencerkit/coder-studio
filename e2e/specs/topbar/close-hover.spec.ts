import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function sanitizeCssModules(css: string): string {
  return css.replaceAll(/:global\(([^)]+)\)/g, "$1");
}

const componentsCss = readFileSync(
  resolve(process.cwd(), "../packages/web/src/styles/components.css"),
  "utf8"
);
const buttonCss = sanitizeCssModules(
  readFileSync(
    resolve(process.cwd(), "../packages/web/src/components/ui/button/index.module.css"),
    "utf8"
  )
);
const iconButtonCss = sanitizeCssModules(
  readFileSync(
    resolve(process.cwd(), "../packages/web/src/components/ui/icon-button/index.module.css"),
    "utf8"
  )
);

test("topbar close button stays vertically centered while hovered", async ({ page }) => {
  await page.setContent(`
    <html>
      <head>
        <style>
          :root {
            --bg-page: #0f1720;
            --bg-surface: #16212c;
            --bg-hover: #223140;
            --bg-active: #1e2c38;
            --border: rgba(123, 152, 180, 0.24);
            --border-light: rgba(173, 201, 229, 0.42);
            --text-primary: #edf4fb;
            --text-secondary: #c8d5e2;
            --text-tertiary: #8fa4b8;
            --accent-blue: #79b8ff;
            --shadow-xl: 0 8px 24px rgba(0, 0, 0, 0.22);
            --radius-sm: 5px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --duration-fast: 120ms;
            --duration-normal: 180ms;
            --ease-out: ease;
            --sp-1: 4px;
            --sp-2: 8px;
            --sp-4: 16px;
            --btn-height-md: 32px;
            --text-base: 14px;
            --text-xs: 12px;
            --font-medium: 500;
            --font-sans: ui-sans-serif, system-ui, sans-serif;
          }
          body {
            margin: 0;
            padding: 24px;
            background: #0b1218;
          }
          ${buttonCss}
          ${iconButtonCss}
          ${componentsCss}
        </style>
      </head>
      <body>
        <div class="topbar-tab-shell active" style="width: 160px;">
          <button class="topbar-tab active" type="button">
            <span class="topbar-dot active"></span>
            <span class="topbar-tab-name">coder-studio</span>
          </button>
          <button class="root btn btn-ghost btn-sm topbar-close" type="button" aria-label="Close Workspace">
            <span class="icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path
                  d="M18 6 6 18M6 6l12 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </span>
          </button>
        </div>
      </body>
    </html>
  `);

  const tabShell = page.locator(".topbar-tab-shell");
  await tabShell.hover();

  const closeButton = page.locator(".topbar-close");
  await expect(closeButton).toBeVisible();

  const beforeHoverBox = await closeButton.boundingBox();
  expect(beforeHoverBox).not.toBeNull();

  await closeButton.hover();

  const afterHoverBox = await closeButton.boundingBox();
  expect(afterHoverBox).not.toBeNull();
  expect(Math.abs((afterHoverBox?.y ?? 0) - (beforeHoverBox?.y ?? 0))).toBeLessThan(0.5);
});
