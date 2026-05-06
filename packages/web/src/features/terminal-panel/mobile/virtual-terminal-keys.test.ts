import { describe, expect, it } from "vitest";

import {
  applyCtrlModeToInput,
  getSoftTerminalInputBytes,
  lockCtrlMode,
  type SoftTerminalKeyId,
  toggleCtrlMode,
} from "./virtual-terminal-keys";

describe("getSoftTerminalInputBytes", () => {
  const keyCases: Array<[SoftTerminalKeyId, string]> = [
    ["escape", "\x1b"],
    ["tab", "\t"],
    ["enter", "\r"],
    ["arrow_up", "\x1b[A"],
    ["arrow_down", "\x1b[B"],
    ["arrow_right", "\x1b[C"],
    ["arrow_left", "\x1b[D"],
  ];

  it.each(keyCases)("maps %s to terminal bytes", (key, expected) => {
    expect(getSoftTerminalInputBytes(key)).toBe(expected);
  });

  it.each([
    ["tab", "\x1b[Z"],
    ["arrow_up", "\x1b[1;2A"],
    ["arrow_down", "\x1b[1;2B"],
    ["arrow_right", "\x1b[1;2C"],
    ["arrow_left", "\x1b[1;2D"],
  ] satisfies Array<
    [SoftTerminalKeyId, string]
  >)("maps shifted %s to modified terminal bytes", (key, expected) => {
    expect(getSoftTerminalInputBytes(key, { shift: true })).toBe(expected);
  });

  it("keeps escape and enter unchanged when shift is armed", () => {
    expect(getSoftTerminalInputBytes("escape", { shift: true })).toBe("\x1b");
    expect(getSoftTerminalInputBytes("enter", { shift: true })).toBe("\r");
  });
});

describe("ctrl mode helpers", () => {
  it("toggles off to armed and armed to off", () => {
    expect(toggleCtrlMode("off")).toBe("armed");
    expect(toggleCtrlMode("armed")).toBe("off");
  });

  it("toggles locked to off", () => {
    expect(toggleCtrlMode("locked")).toBe("off");
  });

  it("locks ctrl mode", () => {
    expect(lockCtrlMode()).toBe("locked");
  });
});

describe("applyCtrlModeToInput", () => {
  it.each([
    ["a", "\x01"],
    ["A", "\x01"],
    ["z", "\x1a"],
    ["Z", "\x1a"],
  ])("converts single alpha %s into control byte", (input, expected) => {
    expect(applyCtrlModeToInput(input, "armed")).toEqual({
      data: expected,
      nextCtrlMode: "off",
      activity: "control",
    });

    expect(applyCtrlModeToInput(input, "locked")).toEqual({
      data: expected,
      nextCtrlMode: "locked",
      activity: "control",
    });
  });

  it("leaves input unchanged when ctrl mode is off", () => {
    expect(applyCtrlModeToInput("a", "off")).toEqual({
      data: "a",
      nextCtrlMode: "off",
    });
  });

  it.each([
    "1",
    "-",
    "\r",
    "\x1b",
    "ab",
    "中",
    "a ",
    "🙂",
  ])("keeps non-letter or multi-char input %j unchanged while preserving mode", (input) => {
    const armedResult = applyCtrlModeToInput(input, "armed");
    const lockedResult = applyCtrlModeToInput(input, "locked");

    expect(armedResult).toEqual({
      data: input,
      nextCtrlMode: "armed",
    });
    expect(lockedResult).toEqual({
      data: input,
      nextCtrlMode: "locked",
    });
  });
});
