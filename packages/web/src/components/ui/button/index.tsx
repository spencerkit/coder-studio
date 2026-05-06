import clsx from "clsx";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./index.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonBaseProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
}

type ButtonElementProps = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> & {
    readonly as?: "button";
  };

type AnchorElementProps = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBaseProps> & {
    readonly as: "a";
  };

export type ButtonProps = ButtonElementProps | AnchorElementProps;

const variantClassMap: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
};

const sizeClassMap: Record<ButtonSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
  lg: styles.lg,
};

const legacyVariantClassMap: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const legacySizeClassMap: Record<ButtonSize, string | undefined> = {
  sm: "btn-sm",
  md: undefined,
  lg: "btn-lg",
};

const ButtonContent = ({
  children,
  leadingIcon,
  loading,
  trailingIcon,
}: Pick<ButtonBaseProps, "children" | "leadingIcon" | "loading" | "trailingIcon">) => {
  return (
    <>
      {loading ? (
        <span aria-hidden="true" className={clsx(styles.spinner, "animate-spin")} />
      ) : null}
      {leadingIcon ? (
        <span aria-hidden="true" className={styles.icon}>
          {leadingIcon}
        </span>
      ) : null}
      <span className={styles.label}>{children}</span>
      {trailingIcon ? (
        <span aria-hidden="true" className={styles.icon}>
          {trailingIcon}
        </span>
      ) : null}
    </>
  );
};

export const Button = (props: ButtonProps) => {
  const {
    as = "button",
    children,
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    leadingIcon,
    trailingIcon,
  } = props;

  const classNames = clsx(
    styles.btn,
    variantClassMap[variant],
    sizeClassMap[size],
    "btn",
    legacyVariantClassMap[variant],
    legacySizeClassMap[size],
    loading ? styles.loading : undefined,
    className
  );

  const content = (
    <ButtonContent
      children={children}
      leadingIcon={leadingIcon}
      loading={loading}
      trailingIcon={trailingIcon}
    />
  );

  if (as === "a") {
    const {
      as: _as,
      children: _children,
      className: _className,
      leadingIcon: _leadingIcon,
      loading: _loading,
      size: _size,
      trailingIcon: _trailingIcon,
      variant: _variant,
      ...anchorProps
    } = props as AnchorElementProps;

    return (
      <a {...anchorProps} aria-busy={loading ? "true" : undefined} className={classNames}>
        {content}
      </a>
    );
  }

  const {
    as: _as,
    children: _children,
    className: _className,
    disabled,
    leadingIcon: _leadingIcon,
    loading: _loading,
    size: _size,
    trailingIcon: _trailingIcon,
    type,
    variant: _variant,
    ...buttonProps
  } = props as ButtonElementProps;

  return (
    <button
      {...buttonProps}
      aria-busy={loading ? "true" : undefined}
      className={classNames}
      disabled={disabled || loading}
      type={type ?? "button"}
    >
      {content}
    </button>
  );
};
