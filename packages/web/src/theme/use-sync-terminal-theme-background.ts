/**
 * Keeps alive terminals' OSC 11 injection background in sync when the UI theme
 * changes. Only needed on Windows where ConPTY breaks the xterm.js round trip;
 * the command is harmless on other platforms.
 */

import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { themeAtom } from "../atoms/app-ui";
import type { ConnectionStatus, DispatchCommand } from "../atoms/connection";
import { getThemeById } from "./resolve";

export function useSyncTerminalThemeBackground(
  dispatch: DispatchCommand,
  workspaceId: string | null,
  connectionStatus: ConnectionStatus
): void {
  const themeId = useAtomValue(themeAtom);
  const themeBackground = getThemeById(themeId).terminalTheme.background;

  useEffect(() => {
    if (connectionStatus !== "connected" || !workspaceId) {
      return;
    }

    void dispatch("terminal.syncThemeBackground", {
      workspaceId,
      themeBackground,
    });
  }, [connectionStatus, dispatch, themeBackground, workspaceId]);
}
