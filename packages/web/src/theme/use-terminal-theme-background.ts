/**
 * Returns the hex background color of the currently selected xterm.js theme.
 *
 * Used by session/terminal creation flows to forward the active terminal
 * background to the server, which derives COLORFGBG so child TUIs (Claude
 * Code, Codex, …) can match the page's light/dark intent. This is the only
 * signal that survives the Windows ConPTY layer — OSC 11 background-color
 * queries get intercepted by ConPTY and never reach xterm.js.
 */

import { useAtomValue } from "jotai";
import { themeAtom } from "../atoms/app-ui";
import { getThemeById } from "./resolve";

export function useTerminalThemeBackground(): string {
  const themeId = useAtomValue(themeAtom);
  return getThemeById(themeId).terminalTheme.background;
}
