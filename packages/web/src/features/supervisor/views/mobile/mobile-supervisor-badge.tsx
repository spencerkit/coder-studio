import type { SupervisorState } from '@coder-studio/core';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Eye } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import { supervisorCyclesAtom, supervisorsAtom } from '../../atoms';

interface MobileSupervisorBadgeProps {
  sessionId: string | null;
  onOpen: () => void;
}

export function MobileSupervisorBadge({ sessionId, onOpen }: MobileSupervisorBadgeProps) {
  const supervisors = useAtomValue(supervisorsAtom);
  const cyclesBySupervisor = useAtomValue(supervisorCyclesAtom);
  const t = useTranslation();

  const copy = useMemo(() => {
    if (!sessionId) {
      return null;
    }

    const supervisor = supervisors.get(sessionId);
    if (!supervisor) {
      return {
        state: 'inactive' as SupervisorState,
        label: t('supervisor.title'),
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
  }, [cyclesBySupervisor, sessionId, supervisors, t]);

  if (!copy) {
    return null;
  }

  return (
    <button
      type="button"
      className={`mobile-supervisor-badge mobile-supervisor-badge--${copy.state}`}
      aria-label={t('mobile.supervisor.open_sheet')}
      onClick={onOpen}
    >
      <span className="mobile-supervisor-badge__icon" aria-hidden="true">
        <Eye size={13} />
      </span>
      <span className="mobile-supervisor-badge__label">{copy.label}</span>
    </button>
  );
}
