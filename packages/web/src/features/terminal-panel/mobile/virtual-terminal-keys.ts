import type { TerminalInputActivity } from "@coder-studio/core";

export type CtrlMode = "off" | "armed" | "locked";

export type SoftTerminalKeyId =
  | "escape"
  | "tab"
  | "enter"
  | "arrow_up"
  | "arrow_down"
  | "arrow_left"
  | "arrow_right";

const SOFT_TERMINAL_INPUT_BYTES: Record<SoftTerminalKeyId, string> = {
  escape: "\x1b",
  tab: "\t",
  enter: "\r",
  arrow_up: "\x1b[A",
  arrow_down: "\x1b[B",
  arrow_left: "\x1b[D",
  arrow_right: "\x1b[C",
};

const SHIFTED_SOFT_TERMINAL_INPUT_BYTES: Partial<Record<SoftTerminalKeyId, string>> = {
  tab: "\x1b[Z",
  arrow_up: "\x1b[1;2A",
  arrow_down: "\x1b[1;2B",
  arrow_left: "\x1b[1;2D",
  arrow_right: "\x1b[1;2C",
};

const CONTROL_ACTIVITY: TerminalInputActivity = "control";

export function getSoftTerminalInputBytes(
  key: SoftTerminalKeyId,
  options?: { shift?: boolean }
): string {
  if (options?.shift) {
    return SHIFTED_SOFT_TERMINAL_INPUT_BYTES[key] ?? SOFT_TERMINAL_INPUT_BYTES[key];
  }

  return SOFT_TERMINAL_INPUT_BYTES[key];
}

export function toggleCtrlMode(current: CtrlMode): CtrlMode {
  return current === "off" ? "armed" : "off";
}

export function lockCtrlMode(): CtrlMode {
  return "locked";
}

export function applyCtrlModeToInput(
  data: string,
  ctrlMode: CtrlMode
): {
  data: string;
  nextCtrlMode: CtrlMode;
  activity?: TerminalInputActivity;
} {
  if (ctrlMode === "off") {
    return { data, nextCtrlMode: "off" };
  }

  if (!/^[A-Za-z]$/.test(data)) {
    return { data, nextCtrlMode: ctrlMode };
  }

  const uppercase = data.toUpperCase();
  const controlByte = String.fromCharCode(uppercase.charCodeAt(0) - 64);

  return {
    data: controlByte,
    nextCtrlMode: ctrlMode === "armed" ? "off" : "locked",
    activity: CONTROL_ACTIVITY,
  };
}
