import { useAtomValue, useSetAtom } from "jotai";
import { GitBranch } from "lucide-react";
import type { FC } from "react";
import { Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { branchQuickPickAtom, gitBranchListAtomFamily } from "../../atoms";

interface BranchPickerButtonProps {
  workspaceId: string;
}

export const BranchPickerButton: FC<BranchPickerButtonProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const branchList = useAtomValue(gitBranchListAtomFamily(workspaceId));
  const setQuickPick = useSetAtom(branchQuickPickAtom);
  const branchName = branchList.current || t("git.no_branch");
  const switchBranchLabel = t("git.switch_branch");
  const accessibleLabel = branchList.current
    ? `${t("git.current_branch")}: ${branchList.current}. ${switchBranchLabel}`
    : `${t("git.no_branch")}. ${switchBranchLabel}`;

  const handleClick = () => {
    setQuickPick({
      visible: true,
      workspaceId,
      inputValue: "",
    });
  };

  return (
    <Tooltip content={switchBranchLabel}>
      <button
        aria-label={accessibleLabel}
        className="panel-toolbar-btn branch-picker-btn"
        onClick={handleClick}
        type="button"
      >
        <GitBranch size={14} />
        <span className="branch-name">{branchName}</span>
      </button>
    </Tooltip>
  );
};
