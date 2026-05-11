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
