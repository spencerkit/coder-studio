import type { WorkspaceMemoryEntry, WorkspaceMemoryType } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { workspaceTopic } from "../../../ws";

interface MemoryCreateInput {
  content: string;
  type: WorkspaceMemoryType;
}

interface MemoryUpdateInput extends MemoryCreateInput {
  id: string;
}

function commandErrorMessage(fallback: string, error?: { message?: string }): string {
  return error?.message?.trim() || fallback;
}

export function useMemoryPanel(workspaceId: string) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const [entries, setEntries] = useState<WorkspaceMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshMemory = useCallback(async () => {
    setLoading(true);
    const result = await dispatch<WorkspaceMemoryEntry[]>("memory.list", { workspaceId });
    setLoading(false);

    if (!result.ok || !result.data) {
      setErrorMessage(commandErrorMessage("Failed to load memory", result.error));
      return [];
    }

    setEntries(result.data);
    setErrorMessage(null);
    return result.data;
  }, [dispatch, workspaceId]);

  const createMemory = useCallback(
    async (input: MemoryCreateInput) => {
      setSaving(true);
      const result = await dispatch<WorkspaceMemoryEntry>("memory.create", {
        workspaceId,
        ...input,
      });
      setSaving(false);

      if (!result.ok || !result.data) {
        setErrorMessage(commandErrorMessage("Failed to create memory", result.error));
        return null;
      }

      setErrorMessage(null);
      await refreshMemory();
      return result.data;
    },
    [dispatch, refreshMemory, workspaceId]
  );

  const updateMemory = useCallback(
    async (input: MemoryUpdateInput) => {
      setSaving(true);
      const result = await dispatch<WorkspaceMemoryEntry>("memory.update", {
        workspaceId,
        ...input,
      });
      setSaving(false);

      if (!result.ok || !result.data) {
        setErrorMessage(commandErrorMessage("Failed to update memory", result.error));
        return null;
      }

      setErrorMessage(null);
      await refreshMemory();
      return result.data;
    },
    [dispatch, refreshMemory, workspaceId]
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      setSaving(true);
      const result = await dispatch<WorkspaceMemoryEntry>("memory.delete", { workspaceId, id });
      setSaving(false);

      if (!result.ok || !result.data) {
        setErrorMessage(commandErrorMessage("Failed to delete memory", result.error));
        return null;
      }

      setErrorMessage(null);
      await refreshMemory();
      return result.data;
    },
    [dispatch, refreshMemory, workspaceId]
  );

  useEffect(() => {
    if (!wsClient || typeof wsClient.subscribe !== "function") {
      return;
    }

    return wsClient.subscribe([workspaceTopic(workspaceId, "memory", "changed")], () => {
      void refreshMemory();
    });
  }, [refreshMemory, workspaceId, wsClient]);

  return {
    createMemory,
    deleteMemory,
    entries,
    errorMessage,
    loading,
    refreshMemory,
    saving,
    updateMemory,
  };
}
