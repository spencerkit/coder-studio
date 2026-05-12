import { describe, expect, it } from "vitest";
import { buildManifestEntry, renderReportHtml } from "./build-report";

describe("build-report", () => {
  it("builds a manifest entry from a screenshot path", () => {
    const entry = buildManifestEntry({
      scene: {
        id: "welcome",
        title: "Welcome",
        category: "page",
        source: "real-route",
        description: "Welcome page",
      },
      screenshotPath: "screenshots/page/welcome/desktop__mint-light__zh.png",
      variant: {
        device: "desktop",
        theme: "mint-light",
        locale: "zh",
      },
    });

    expect(entry).toMatchObject({
      id: "welcome",
      category: "page",
      path: "screenshots/page/welcome/desktop__mint-light__zh.png",
      device: "desktop",
      theme: "mint-light",
      locale: "zh",
    });
  });

  it("keeps icon review scene manifest entries grouped by exact scene id and theme", () => {
    const entry = buildManifestEntry({
      scene: {
        id: "toast-icon-review",
        title: "Toast Icon Review",
        category: "toast",
        source: "showcase",
        description: "Theme review for toast icons",
      },
      screenshotPath: "screenshots/toast/toast-icon-review/mobile__graphite-light__en.png",
      variant: {
        device: "mobile",
        theme: "graphite-light",
        locale: "en",
      },
    });

    expect(entry).toMatchObject({
      id: "toast-icon-review",
      theme: "graphite-light",
    });
  });

  it("renders a report html shell with filters and grouped scenes", () => {
    const html = renderReportHtml([
      {
        id: "welcome",
        title: "Welcome",
        category: "page",
        source: "real-route",
        device: "desktop",
        theme: "mint-light",
        locale: "zh",
        path: "screenshots/page/welcome/desktop__mint-light__zh.png",
        description: "Welcome page",
      },
    ]);

    expect(html).toContain("UI Preview Report");
    expect(html).toContain("screenshots/page/welcome/desktop__mint-light__zh.png");
    expect(html).toContain('data-category="page"');
  });
});
