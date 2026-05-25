import type { Terminal as TerminalDto } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { useTerminalThemeBackground } from "../../../theme";
import { pushToastAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../atoms";

function toTerminalMeta(terminal: TerminalDto) {
  return {
    id: terminal.id,
    workspaceId: terminal.workspaceId,
    kind: terminal.kind,
    alive: terminal.alive,
    exitCode: terminal.exitCode,
    title: terminal.title,
  } as const;
}

export function useCreateShellTerminal(workspaceId: string | null) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();
  const themeBackground = useTerminalThemeBackground();

  return {
    async createShellTerminal(args: { cwdPath?: string } = {}) {
      if (!workspaceId) {
        pushToast({
          kind: "warning",
          title: t("terminal.create_unavailable_title"),
          body: t("terminal.create_unavailable_body"),
        });
        return null;
      }

      try {
        const result = await dispatch<TerminalDto>("terminal.create", {
          workspaceId,
          cwdPath: args.cwdPath,
          themeBackground,
        });

        if (!result.ok || !result.data) {
          pushToast({
            kind: "error",
            title: t("terminal.create_failed_title"),
            body: result.error?.message ?? t("terminal.create_failed_body"),
          });
          return null;
        }

        const terminal = result.data;
        store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
        store.set(terminalIdsAtomFamily(workspaceId), (current) =>
          current.includes(terminal.id) ? current : [...current, terminal.id]
        );
        store.set(terminalActiveIdAtomFamily(workspaceId), terminal.id);
        return terminal;
      } catch (error) {
        pushToast({
          kind: "error",
          title: t("terminal.create_failed_title"),
          body: error instanceof Error ? error.message : t("terminal.create_failed_body"),
        });
        return null;
      }
    },
  };
}
