import { X } from "lucide-react";
import {
  Button,
  DialogHeader,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalTitle,
  Notice,
  Select,
  type SelectOption,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface AgentInstructionsGenerateDialogProps {
  open: boolean;
  mode: "generate" | "regenerate";
  providerId: string;
  providerOptions: ReadonlyArray<SelectOption<string>>;
  model: string;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
}

export function AgentInstructionsGenerateDialog({
  open,
  mode,
  providerId,
  providerOptions,
  model,
  error,
  loading,
  onClose,
  onProviderChange,
  onModelChange,
  onSubmit,
}: AgentInstructionsGenerateDialogProps) {
  const t = useTranslation();

  if (!open) {
    return null;
  }

  const title =
    mode === "regenerate"
      ? t("workspace.agent_instructions.regenerate_dialog_title")
      : t("workspace.agent_instructions.generate_title");
  const description =
    mode === "regenerate"
      ? t("workspace.agent_instructions.regenerate_dialog_body")
      : t("workspace.agent_instructions.generate_body");
  const submitLabel =
    mode === "regenerate"
      ? t("workspace.agent_instructions.regenerate_short")
      : t("workspace.agent_instructions.generate_short");

  return (
    <Modal
      dismissible={!loading}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open
    >
      <DialogHeader>
        <div className="dialog-header__copy">
          <ModalTitle>{title}</ModalTitle>
          <p className="dialog-helper">{description}</p>
        </div>
        <IconButton
          aria-label={t("action.close")}
          className="modal-close"
          disabled={loading}
          icon={<X size={14} />}
          onClick={onClose}
          size="sm"
        />
      </DialogHeader>

      <ModalBody>
        <div className="form-group">
          <label htmlFor="agent-instructions-provider">
            {t("workspace.agent_instructions.provider_label")}
          </label>
          <Select
            id="agent-instructions-provider"
            aria-label={t("workspace.agent_instructions.provider_label")}
            disabled={loading}
            options={providerOptions}
            size="sm"
            value={providerId}
            onValueChange={onProviderChange}
          />
        </div>

        <div className="form-group">
          <label htmlFor="agent-instructions-model">
            {t("workspace.agent_instructions.model_label")}
          </label>
          <Input
            id="agent-instructions-model"
            disabled={loading}
            placeholder={t("workspace.agent_instructions.model_placeholder")}
            size="sm"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
          />
          <span className="dialog-helper">{t("workspace.agent_instructions.model_helper")}</span>
        </div>

        {error ? <Notice message={error} tone="error" /> : null}
      </ModalBody>

      <ModalFooter>
        <Button disabled={loading} onClick={onClose}>
          {t("action.cancel")}
        </Button>
        <Button loading={loading} onClick={() => void onSubmit()} variant="primary">
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
