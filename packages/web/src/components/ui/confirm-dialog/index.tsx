import clsx from "clsx";
import { AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "../button";
import { IconButton } from "../icon-button";
import { Modal, ModalBody, ModalFooter, ModalHeader, type ModalProps, ModalTitle } from "../modal";
import styles from "./index.module.css";

export type ConfirmDialogTone = "default" | "danger";

type ConfirmButtonProps = Omit<ButtonProps, "children" | "onClick" | "variant">;

export interface ConfirmDialogProps
  extends Pick<ModalProps, "className" | "dismissible" | "initialFocus" | "onOpenChange" | "open"> {
  readonly cancelText: ReactNode;
  readonly closeLabel?: string;
  readonly confirmButtonProps?: ConfirmButtonProps;
  readonly confirmDisabled?: boolean;
  readonly confirmText: ReactNode;
  readonly description?: ReactNode;
  readonly onConfirm: () => void;
  readonly title: ReactNode;
  readonly tone?: ConfirmDialogTone;
}

const confirmVariantMap = {
  default: "primary",
  danger: "danger",
} as const;

export function ConfirmDialog({
  cancelText,
  className,
  closeLabel = "Close",
  confirmButtonProps,
  confirmDisabled = false,
  confirmText,
  description,
  dismissible = true,
  initialFocus,
  onConfirm,
  onOpenChange,
  open,
  title,
  tone = "default",
}: ConfirmDialogProps) {
  const {
    className: confirmClassName,
    disabled: confirmButtonDisabled,
    ...confirmButtonRest
  } = confirmButtonProps ?? {};

  return (
    <Modal
      className={className}
      dismissible={dismissible}
      initialFocus={initialFocus}
      onOpenChange={onOpenChange}
      open={open}
    >
      <ModalHeader>
        <ModalTitle className={clsx(tone === "danger" ? styles.titleDanger : undefined)}>
          {tone === "danger" ? (
            <AlertTriangle aria-hidden="true" className={styles.iconDanger} size={16} />
          ) : null}
          <span>{title}</span>
        </ModalTitle>
        {dismissible ? (
          <IconButton
            aria-label={closeLabel}
            className="modal-close"
            icon={<X size={14} />}
            onClick={() => onOpenChange(false)}
            size="sm"
          />
        ) : null}
      </ModalHeader>

      {description ? <ModalBody className={styles.body}>{description}</ModalBody> : null}

      <ModalFooter>
        <Button onClick={() => onOpenChange(false)}>{cancelText}</Button>
        <Button
          {...confirmButtonRest}
          className={confirmClassName}
          disabled={confirmDisabled || confirmButtonDisabled}
          onClick={onConfirm}
          variant={confirmVariantMap[tone]}
        >
          {confirmText}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
