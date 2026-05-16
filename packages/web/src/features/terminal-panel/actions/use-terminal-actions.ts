import { type Terminal as TerminalDto, Topics } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { activationStatusAtom } from "../../../atoms/activation";
import { connectionStatusAtom, dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import type { TerminalBinaryPayload } from "../../../ws/client";
import { pushToastAtom } from "../../notifications/atoms";
import { terminalMetaAtomFamily, terminalOutputAtomFamily } from "../atoms";

const EMPTY_TERMINAL_ID = "__terminal_panel_empty__";

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
  const activationStatus = useAtomValue(activationStatusAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();

  const [terminalIds, setTerminalIds] = useState<string[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
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

    if (wsClient && typeof wsClient.getStatus === "function" && connectionStatus !== "connected") {
      return;
    }

    if (
      activationStatus === "claiming" ||
      activationStatus === "gated" ||
      activationStatus === "revoked"
    ) {
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
  }, [
    activeWorkspaceId,
    activationStatus,
    connectionStatus,
    dispatch,
    pushToast,
    store,
    t,
    wsClient,
  ]);

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
    if (!activeWorkspaceId) {
      pushToast({
        kind: "warning",
        title: t("terminal.create_unavailable_title"),
        body: t("terminal.create_unavailable_body"),
      });
      return;
    }

    try {
      const result = await dispatch<TerminalDto>("terminal.create", {
        workspaceId: activeWorkspaceId,
        kind: "shell",
      });

      if (!result.ok || !result.data) {
        pushToast({
          kind: "error",
          title: t("terminal.create_failed_title"),
          body: result.error?.message ?? t("terminal.create_failed_body"),
        });
        return;
      }

      const terminal = result.data;
      store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));

      setTerminalIds((previous) => {
        if (previous.includes(terminal.id)) {
          return previous;
        }
        return [...previous, terminal.id];
      });
      setActiveTerminalId(terminal.id);
    } catch (error) {
      pushToast({
        kind: "error",
        title: t("terminal.create_failed_title"),
        body: error instanceof Error ? error.message : t("terminal.create_failed_body"),
      });
    }
  }, [activeWorkspaceId, dispatch, pushToast, store, t]);

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
    [dispatch]
  );

  const handleSwitchTerminal = useCallback((terminalId: string) => {
    setActiveTerminalId(terminalId);
  }, []);

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
