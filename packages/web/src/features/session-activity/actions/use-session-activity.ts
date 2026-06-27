import type { SessionActivityEntry } from "@coder-studio/core";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { sessionByIdAtomFamily } from "../../../atoms/sessions";
import { sessionTopic } from "../../../ws";
import {
  type SessionActivityKindFilter,
  sessionActivityDialogOpenAtomFamily,
  sessionActivityKindFilterAtomFamily,
} from "../atoms";

interface SessionActivityListResult {
  sessionId: string;
  entries: SessionActivityEntry[];
}

function commandErrorMessage(fallback: string, error?: { message?: string }): string {
  return error?.message?.trim() || fallback;
}

export function useSessionActivity(sessionId: string, workspaceId: string) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const session = useAtomValue(sessionByIdAtomFamily(sessionId));
  const [open, setOpen] = useAtom(sessionActivityDialogOpenAtomFamily(sessionId));
  const [filter, setFilter] = useAtom(sessionActivityKindFilterAtomFamily(sessionId));
  const [entries, setEntries] = useState<SessionActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshActivity = useCallback(async () => {
    setLoading(true);
    const result = await dispatch<SessionActivityListResult>("session.activity.list", {
      sessionId,
    });
    setLoading(false);

    if (!result.ok || !result.data) {
      setErrorMessage(commandErrorMessage("Failed to load session logs", result.error));
      setEntries([]);
      return [];
    }

    const nextEntries = [...result.data.entries].sort(
      (left, right) => right.createdAt - left.createdAt
    );
    setEntries(nextEntries);
    setErrorMessage(null);
    return nextEntries;
  }, [dispatch, sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshActivity();
  }, [open, refreshActivity]);

  useEffect(() => {
    if (!wsClient || typeof wsClient.subscribe !== "function") {
      return;
    }

    return wsClient.subscribe(
      [sessionTopic(workspaceId, sessionId, "activity.changed")],
      (_topic, payload) => {
        if (!open) {
          return;
        }

        const event = payload as { sessionId?: string } | null;
        if (event?.sessionId !== sessionId) {
          return;
        }

        void refreshActivity();
      }
    );
  }, [open, refreshActivity, sessionId, workspaceId, wsClient]);

  const filteredEntries = useMemo(() => {
    if (filter === "all") {
      return entries;
    }
    return entries.filter((entry) => entry.kind === filter);
  }, [entries, filter]);

  return {
    entries: filteredEntries,
    errorMessage,
    filter,
    loading,
    open,
    refreshActivity,
    session,
    setFilter: setFilter as (value: SessionActivityKindFilter) => void,
    setOpen,
  };
}
