import type { WorktreeInfo } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { resolvedActiveWorkspaceIdAtom } from "../../../../atoms/workspaces";
import {
  IconButton,
  Modal,
  ModalBody,
  ModalHeader,
  ModalTitle,
  Sheet,
} from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { WorktreeDetailPanel } from "./worktree-detail-panel";

interface WorktreeModalProps {
  workspaceId?: string;
  worktree: WorktreeInfo | null;
  onClose: () => void;
}

export function WorktreeModal({ workspaceId, worktree, onClose }: WorktreeModalProps) {
  const isMobile = useViewport() === "mobile";
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const t = useTranslation();
  const resolvedWorkspaceId = workspaceId ?? activeWorkspaceId;

  if (!worktree || !resolvedWorkspaceId) {
    return null;
  }

  if (isMobile) {
    return (
      <Sheet
        kicker={t("worktree.title").toUpperCase()}
        title={worktree.name}
        body={
          <div className="mobile-worktree-sheet">
            <WorktreeDetailPanel workspaceId={resolvedWorkspaceId} worktree={worktree} mobile />
          </div>
        }
        bodyClassName="mobile-sheet__body--flush"
        contentClassName="mobile-sheet--worktree"
        onClose={onClose}
      />
    );
  }

  return (
    <Modal open onOpenChange={onClose} size="lg">
      <ModalHeader>
        <div className="worktree-header-info">
          <ModalTitle>{worktree.name}</ModalTitle>
        </div>
        <IconButton
          aria-label={t("action.close")}
          icon={<X size={14} />}
          onClick={onClose}
          size="sm"
        />
      </ModalHeader>
      <ModalBody>
        <WorktreeDetailPanel workspaceId={resolvedWorkspaceId} worktree={worktree} />
      </ModalBody>
    </Modal>
  );
}
