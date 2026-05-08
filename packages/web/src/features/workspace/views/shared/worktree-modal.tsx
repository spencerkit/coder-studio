import type { WorktreeInfo } from "@coder-studio/core";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { MobileSheet } from "../mobile/mobile-sheet";
import { WorktreeDetailPanel } from "./worktree-detail-panel";

interface WorktreeModalProps {
  workspaceId: string;
  worktree: WorktreeInfo | null;
  onClose: () => void;
}

export function WorktreeModal({ workspaceId, worktree, onClose }: WorktreeModalProps) {
  const isMobile = useViewport() === "mobile";
  const t = useTranslation();

  if (!worktree) {
    return null;
  }

  if (isMobile) {
    return (
      <MobileSheet
        kicker={t("worktree.title").toUpperCase()}
        title={worktree.name}
        body={
          <div className="mobile-worktree-sheet">
            <WorktreeDetailPanel workspaceId={workspaceId} worktree={worktree} mobile />
          </div>
        }
        bodyClassName="mobile-sheet__body--flush"
        contentClassName="mobile-sheet--worktree"
        onClose={onClose}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-lg" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="worktree-header-info">
            <h3>{worktree.name}</h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <WorktreeDetailPanel workspaceId={workspaceId} worktree={worktree} />
      </div>
    </div>
  );
}
