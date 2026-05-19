import { type Terminal as TerminalDto, Topics } from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import type { TerminalBinaryPayload } from "../../../ws/client";
import { pushToastAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
  terminalOutputAtomFamily,
} from "../atoms";
import { useCreateShellTerminal } from "./use-create-shell-terminal";

const EMPTY_TERMINAL_ID = "__terminal_panel_empty__";
const EMPTY_WORKSPACE_ID = "__terminal_panel_empty_workspace__";

function mergeTerminalIds(existing: string[], incoming: string[]): string[] {
  const seen = new Set(incoming);
  const merged = [...incoming];

  for (const id of existing) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }

  return merged;
}

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

export function useTerminalActions() {
  const t = useTranslation();
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();
  const workspaceAtomKey = activeWorkspaceId ?? EMPTY_WORKSPACE_ID;
  const [terminalIds, setTerminalIds] = useAtom(terminalIdsAtomFamily(workspaceAtomKey));
  const [activeTerminalId, setActiveTerminalId] = useAtom(
    terminalActiveIdAtomFamily(workspaceAtomKey)
  );
  const { createShellTerminal } = useCreateShellTerminal(activeWorkspaceId);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const activeTerminalMetaState = useAtomValue(
    terminalMetaAtomFamily(activeTerminalId ?? EMPTY_TERMINAL_ID)
  );
  const activeTerminalMeta = activeTerminalId ? activeTerminalMetaState : null;

  useEffect(() => {
    if (!activeWorkspaceId) {
      setTerminalIds([]);
      setActiveTerminalId(null);
      return;
    }

    let cancelled = false;
    setTerminalIds([]);
    setActiveTerminalId(null);

    void dispatch<TerminalDto[]>("terminal.list", { workspaceId: activeWorkspaceId })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok || !result.data) {
          console.error("Failed to fetch terminals:", result.error?.message);
          pushToast({
            kind: "error",
            title: t("terminal.load_failed_title"),
            body: result.error?.message ?? t("terminal.load_failed_body"),
          });
          return;
        }

        const shellTerminals = result.data.filter((terminal) => terminal.kind === "shell");
        const shellIds = shellTerminals.map((terminal) => terminal.id);

        for (const terminal of shellTerminals) {
          store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
        }

        setTerminalIds((current) => mergeTerminalIds(current, shellIds));
        setActiveTerminalId((current) => current ?? shellIds[0] ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to fetch terminals:", error);
          pushToast({
            kind: "error",
            title: t("terminal.load_failed_title"),
            body: error instanceof Error ? error.message : t("terminal.load_failed_body"),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, dispatch, pushToast, store, t]);

  useEffect(() => {
    if (!wsClient || !activeWorkspaceId) {
      return;
    }

    const allTerminalsTopic = Topics.terminalsAll(activeWorkspaceId);

    unsubscribeRef.current = wsClient.subscribe([allTerminalsTopic], (topic, payload, seq) => {
      const parts = topic.split(".");
      if (parts.length < 5) {
        return;
      }

      const terminalId = parts[3];
      const event = parts[4];

      if (event === "created") {
        const createData = payload as { id: string; kind: "shell" | "agent" };
        if (createData.kind !== "shell") {
          return;
        }

        setTerminalIds((previous) => {
          if (previous.includes(createData.id)) {
            return previous;
          }
          return [...previous, createData.id];
        });
        setActiveTerminalId(createData.id);
        return;
      }

      if (event !== "output") {
        return;
      }

      const meta = store.get(terminalMetaAtomFamily(terminalId));
      if (!meta || meta.kind !== "shell") {
        return;
      }

      const outputData = payload as TerminalBinaryPayload;
      const outputAtom = terminalOutputAtomFamily(terminalId);
      const previous = store.get(outputAtom);
      if (seq <= previous.lastSeq) {
        return;
      }

      store.set(outputAtom, {
        chunks: [...previous.chunks, outputData.bytes],
        lastSeq: seq,
      });
    });

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [activeWorkspaceId, store, wsClient]);

  const handleCreateTerminal = useCallback(async () => {
    await createShellTerminal();
  }, [createShellTerminal]);

  const handleCloseTerminal = useCallback(
    async (terminalId: string) => {
      const result = await dispatch("terminal.close", { terminalId });
      if (!result.ok) {
        return;
      }

      setTerminalIds((previous) => {
        const remainingIds = previous.filter((id) => id !== terminalId);
        setActiveTerminalId((current) => {
          if (current !== terminalId) {
            return current;
          }
          return remainingIds[0] ?? null;
        });
        return remainingIds;
      });
    },
    [dispatch, setActiveTerminalId, setTerminalIds]
  );

  const handleSwitchTerminal = useCallback(
    (terminalId: string) => {
      setActiveTerminalId(terminalId);
    },
    [setActiveTerminalId]
  );

  return {
    activeTerminalId,
    activeTerminalMeta,
    activeWorkspaceId,
    handleCloseTerminal,
    handleCreateTerminal,
    handleSwitchTerminal,
    hasTerminals: terminalIds.length > 0,
    terminalIds,
  };
}
