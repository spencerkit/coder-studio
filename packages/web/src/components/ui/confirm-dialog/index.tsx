import clsx from "clsx";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "../button";
import { IconButton } from "../icon-button";
import { Modal, ModalBody, ModalFooter, ModalHeader, type ModalProps, ModalTitle } from "../modal";
import { ThemedIcon } from "../themed-icon";
import styles from "./index.module.css";

export type ConfirmDialogTone = "default" | "danger";

type ConfirmButtonProps = Omit<ButtonProps, "children" | "onClick" | "variant">;

export interface ConfirmDialogProps
  extends Pick<ModalProps, "className" | "dismissible" | "initialFocus" | "onOpenChange" | "open"> {
  readonly cancelText: ReactNode;
  readonly cancelDisabled?: boolean;
  readonly closeDisabled?: boolean;
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
  cancelDisabled = false,
  cancelText,
  className,
  closeDisabled = false,
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
        {tone === "danger" ? (
          <div className={clsx("confirmDialogHeaderLeading", styles.headerLeading)}>
            <span
              aria-hidden="true"
              className={clsx("confirmDialogHeaderIcon", styles.headerIcon, styles.iconDanger)}
            >
              <ThemedIcon semantic="state.warning" size={16} />
            </span>
            <div className={clsx("confirmDialogHeaderCopy", styles.headerCopy)}>
              <ModalTitle className={styles.titleDanger}>{title}</ModalTitle>
            </div>
          </div>
        ) : (
          <ModalTitle>{title}</ModalTitle>
        )}
        {dismissible || closeDisabled ? (
          <IconButton
            aria-label={closeLabel}
            className="modal-close"
            disabled={closeDisabled}
            icon={<X size={14} />}
            onClick={() => onOpenChange(false)}
            size="sm"
          />
        ) : null}
      </ModalHeader>

      {description ? <ModalBody className={styles.body}>{description}</ModalBody> : null}

      <ModalFooter>
        <Button disabled={cancelDisabled} onClick={() => onOpenChange(false)}>
          {cancelText}
        </Button>
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
