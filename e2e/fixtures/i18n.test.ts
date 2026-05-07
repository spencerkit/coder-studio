import { describe, expect, it } from "vitest";
import { translateForE2E } from "./i18n.js";

describe("translateForE2E", () => {
  it("defaults to the app default locale for welcome copy", () => {
    expect(translateForE2E("welcome.kicker")).toBe("开始使用");
    expect(translateForE2E("action.open_workspace")).toBe("打开工作区");
  });

  it("can resolve English strings when requested", () => {
    expect(translateForE2E("welcome.kicker", "en")).toBe("GET STARTED");
    expect(translateForE2E("workspace.launch.title", "en")).toBe("Open Workspace");
  });

  it("interpolates variables", () => {
    expect(translateForE2E("workspace.launch.items_count", "zh", { count: 3 })).toBe("3 项");
  });
});
