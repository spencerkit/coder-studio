// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/styles/base.css",
  "src/styles/components.css",
  "src/components/ui/workbench-layer/index.module.css",
  "src/components/ui/button/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/spinner/index.module.css",
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/select/index.module.css",
  "src/components/ui/notice/index.module.css",
  "src/components/ui/toast/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/tooltip/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/drawer/index.module.css",
  "src/components/ui/local-overlay/index.module.css",
  "src/components/ui/popover/index.module.css",
  "src/components/ui/progress-bar/index.module.css",
  "src/components/ui/empty-state/index.module.css",
  "src/components/ui/confirm-dialog/index.module.css",
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);

const rawColorPattern = /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(|\bblur\(\d/;
const runtimePattern = /--app-surface-opacity|--app-surface-backdrop-filter|data-appearance-glass/;
const privateRefPattern = /var\(--ref-/;
const legacyPublicPattern = /var\(--(?:bg-|accent-|color-|ws-)/;

const expectedRawColorConsumers = [
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/button/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/spinner/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/styles/base.css",
  "src/styles/components.css",
];

const expectedRuntimeConsumers = [
  "src/components/ui/workbench-layer/index.module.css",
  "src/styles/base.css",
  "src/styles/components.css",
];

const expectedLegacyPublicConsumers = [
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/button/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/popover/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/select/index.module.css",
  "src/components/ui/spinner/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/toast/index.module.css",
  "src/styles/base.css",
  "src/styles/components.css",
];

function offenders(pattern: RegExp) {
  return files
    .filter(([, source]) => pattern.test(source))
    .map(([file]) => file)
    .sort();
}

describe("color-system migration guard", () => {
  it("tracks the remaining raw-color consumers explicitly", () => {
    expect(offenders(rawColorPattern)).toEqual(expectedRawColorConsumers);
  });

  it("tracks the remaining runtime appearance consumers explicitly", () => {
    expect(offenders(runtimePattern)).toEqual(expectedRuntimeConsumers);
  });

  it("forbids private reference tokens outside tokens.css", () => {
    expect(offenders(privateRefPattern)).toEqual([]);
  });

  it("tracks the remaining legacy public token consumers explicitly", () => {
    expect(offenders(legacyPublicPattern)).toEqual(expectedLegacyPublicConsumers);
  });
});
