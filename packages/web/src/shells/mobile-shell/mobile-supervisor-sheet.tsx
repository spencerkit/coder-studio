import { useAtomValue } from 'jotai';
import { ObjectiveDialog } from '../../features/supervisor/components/objective-dialog';
import { SupervisorCard } from '../../features/supervisor/components/supervisor-card';
import { supervisorsAtom } from '../../features/supervisor/atoms';

interface MobileSupervisorSheetProps {
  sessionId: string;
  workspaceId: string;
}

export function MobileSupervisorSheet({
  sessionId,
  workspaceId,
}: MobileSupervisorSheetProps) {
  const supervisors = useAtomValue(supervisorsAtom);
  const supervisor = supervisors.get(sessionId);

  return (
    <div className="mobile-supervisor-sheet">
      {supervisor ? (
        <SupervisorCard sessionId={sessionId} workspaceId={workspaceId} />
      ) : (
        <div className="mobile-supervisor-sheet__empty">
          <h3>Supervisor</h3>
          <p>Supervisor 未启用</p>
        </div>
      )}
      <ObjectiveDialog workspaceId={workspaceId} sessionId={sessionId} />
    </div>
  );
}
