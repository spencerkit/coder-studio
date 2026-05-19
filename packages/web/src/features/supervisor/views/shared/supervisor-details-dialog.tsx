import { X } from "lucide-react";
import { DialogHeader, IconButton, Modal, ModalBody, ModalTitle } from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { useSupervisorActions } from "../../actions/use-supervisor-actions";
import { useSupervisorDetails } from "../../actions/use-supervisor-details";
import { SupervisorDetailsContent } from "./supervisor-details-content";

interface SupervisorDetailsDialogProps {
  workspaceId: string;
  sessionId?: string;
}

export function SupervisorDetailsDialog({ workspaceId, sessionId }: SupervisorDetailsDialogProps) {
  const viewport = useViewport();
  const t = useTranslation();
  const { details, isVisible, closeDetails } = useSupervisorDetails(sessionId);
  const currentSessionId = sessionId ?? details.sessionId ?? "";
  const { openDialog } = useSupervisorActions({ sessionId: currentSessionId });

  if (!isVisible || viewport === "mobile" || !details.sessionId) {
    return null;
  }

  return (
    <Modal
      className="supervisor-dialog supervisor-dialog--details"
      onOpenChange={closeDetails}
      open
    >
      <DialogHeader>
        <div className="dialog-header__leading">
          <div className="dialog-header__copy">
            <ModalTitle>{t("supervisor.dialog.details.title")}</ModalTitle>
          </div>
        </div>
        <IconButton
          aria-label={t("action.close")}
          className="modal-close"
          icon={<X size={14} />}
          onClick={closeDetails}
          size="sm"
        />
      </DialogHeader>

      <ModalBody>
        <SupervisorDetailsContent
          sessionId={details.sessionId}
          workspaceId={workspaceId}
          onEdit={() => {
            closeDetails();
            openDialog("edit");
          }}
        />
      </ModalBody>
    </Modal>
  );
}
