import type { SupervisorState } from '@coder-studio/core';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { supervisorCyclesAtom, supervisorsAtom } from '../../atoms';

interface MobileSupervisorBadgeProps {
  sessionId: string | null;
  onOpen: () => void;
}

export function MobileSupervisorBadge({ sessionId, onOpen }: MobileSupervisorBadgeProps) {
  const supervisors = useAtomValue(supervisorsAtom);
  const cyclesBySupervisor = useAtomValue(supervisorCyclesAtom);

  const copy = useMemo(() => {
    if (!sessionId) {
      return null;
    }

    const supervisor = supervisors.get(sessionId);
    if (!supervisor) {
      return {
        state: 'inactive' as SupervisorState,
        label: '启用 Supervisor',
      };
    }

    const cycles = cyclesBySupervisor.get(supervisor.id) ?? supervisor.cycles ?? [];
    const latestCycle = [...cycles].sort(
      (left, right) => (right.completedAt ?? right.createdAt) - (left.completedAt ?? left.createdAt)
    )[0];

    return {
      state: supervisor.state,
      label:
        latestCycle?.result ??
        latestCycle?.errorReason ??
        (cycles.length > 0 ? `cycle ${cycles.length}` : supervisor.objective),
    };
  }, [cyclesBySupervisor, sessionId, supervisors]);

  if (!copy) {
    return null;
  }

  return (
    <button
      type="button"
      className={`mobile-supervisor-badge mobile-supervisor-badge--${copy.state}`}
      aria-label="Open Supervisor sheet"
      onClick={onOpen}
    >
      <span className="mobile-supervisor-badge__icon" aria-hidden="true">
        📍
      </span>
      <span className="mobile-supervisor-badge__label">{copy.label}</span>
    </button>
  );
}
