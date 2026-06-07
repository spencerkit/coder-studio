/**
 * Returns the hex background color of the currently selected xterm.js theme.
 *
 * Used by session/terminal creation flows to forward the active terminal
 * background to the server, which derives COLORFGBG so child TUIs (Claude
 * Code, Codex, …) can match the page's light/dark intent. On Windows the
 * server also injects OSC 11 responses for Gemini CLI. OSC 11 queries from
 * the frontend xterm.js path are intercepted by ConPTY and never reach the
 * child on Windows.
 */

import { useAtomValue } from "jotai";
import { themeAtom } from "../atoms/app-ui";
import { getThemeById } from "./resolve";

export function useTerminalThemeBackground(): string {
  const themeId = useAtomValue(themeAtom);
  return getThemeById(themeId).terminalTheme.background;
}
