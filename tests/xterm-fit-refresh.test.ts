import test from "node:test";
import assert from "node:assert/strict";
import { shouldRefreshTerminalAfterFit } from "../apps/web/src/components/terminal/xterm-fit-refresh.ts";

test("shouldRefreshTerminalAfterFit returns true when pane geometry changed but xterm grid stayed the same", () => {
  assert.equal(shouldRefreshTerminalAfterFit({
    previousGeometry: { width: 445, height: 561 },
    nextGeometry: { width: 435, height: 561 },
    previousSize: { cols: 56, rows: 33 },
    nextSize: { cols: 56, rows: 33 },
  }), true);
});

test("shouldRefreshTerminalAfterFit returns false when the grid size changed", () => {
  assert.equal(shouldRefreshTerminalAfterFit({
    previousGeometry: { width: 445, height: 561 },
    nextGeometry: { width: 384, height: 561 },
    previousSize: { cols: 56, rows: 33 },
    nextSize: { cols: 49, rows: 33 },
  }), false);
});

test("shouldRefreshTerminalAfterFit returns false when geometry did not change", () => {
  assert.equal(shouldRefreshTerminalAfterFit({
    previousGeometry: { width: 445, height: 561 },
    nextGeometry: { width: 445, height: 561 },
    previousSize: { cols: 56, rows: 33 },
    nextSize: { cols: 56, rows: 33 },
  }), false);
});
