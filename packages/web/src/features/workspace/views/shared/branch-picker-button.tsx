import type { FC } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { GitBranch } from 'lucide-react';
import { branchQuickPickAtom, gitBranchListAtomFamily } from '../../atoms';

interface BranchPickerButtonProps {
  workspaceId: string;
}

export const BranchPickerButton: FC<BranchPickerButtonProps> = ({ workspaceId }) => {
  const branchList = useAtomValue(gitBranchListAtomFamily(workspaceId));
  const setQuickPick = useSetAtom(branchQuickPickAtom);

  const handleClick = () => {
    setQuickPick({
      visible: true,
      workspaceId,
      inputValue: '',
    });
  };

  return (
    <button
      className="panel-toolbar-btn branch-picker-btn"
      onClick={handleClick}
      title="Switch Branch"
      type="button"
    >
      <GitBranch size={14} />
      <span className="branch-name">{branchList.current || 'No branch'}</span>
    </button>
  );
};
