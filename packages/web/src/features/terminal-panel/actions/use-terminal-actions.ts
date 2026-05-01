import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { Topics, type Terminal as TerminalDto } from '@coder-studio/core';
import { dispatchCommandAtom, wsClientAtom } from '../../../atoms/connection';
import { resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';
import { terminalMetaAtomFamily, terminalOutputAtomFamily } from '../atoms/terminals';
import type { TerminalBinaryPayload } from '../../../ws/client';

const EMPTY_TERMINAL_ID = '__terminal_panel_empty__';

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
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
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

    let cancelled = false;
    setTerminalIds([]);
    setActiveTerminalId(null);

    void dispatch<TerminalDto[]>('terminal.list', { workspaceId: activeWorkspaceId })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok || !result.data) {
          console.error('Failed to fetch terminals:', result.error?.message);
          return;
        }

        const shellTerminals = result.data.filter((terminal) => terminal.kind === 'shell');
        const shellIds = shellTerminals.map((terminal) => terminal.id);

        for (const terminal of shellTerminals) {
          store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
        }

        setTerminalIds((current) => mergeTerminalIds(current, shellIds));
        setActiveTerminalId((current) => current ?? shellIds[0] ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch terminals:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, dispatch, store]);

  useEffect(() => {
    if (!wsClient || !activeWorkspaceId) {
      return;
    }

    const allTerminalsTopic = Topics.terminalsAll(activeWorkspaceId);

    unsubscribeRef.current = wsClient.subscribe([allTerminalsTopic], (topic, payload, seq) => {
      const parts = topic.split('.');
      if (parts.length < 5) {
        return;
      }

      const terminalId = parts[3];
      const event = parts[4];

      if (event === 'created') {
        const createData = payload as { id: string; kind: 'shell' | 'agent' };
        if (createData.kind !== 'shell') {
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

      if (event !== 'output') {
        return;
      }

      const meta = store.get(terminalMetaAtomFamily(terminalId));
      if (!meta || meta.kind !== 'shell') {
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
      return;
    }

    const result = await dispatch<TerminalDto>('terminal.create', {
      workspaceId: activeWorkspaceId,
      kind: 'shell',
    });

    if (!result.ok || !result.data) {
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
  }, [activeWorkspaceId, dispatch, store]);

  const handleCloseTerminal = useCallback(
    async (terminalId: string) => {
      const result = await dispatch('terminal.close', { terminalId });
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
