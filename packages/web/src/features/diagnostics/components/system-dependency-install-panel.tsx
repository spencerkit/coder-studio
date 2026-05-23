import type { SystemDependencyInstallJobSnapshot } from "@coder-studio/core";
import { useState } from "react";
import { Button, Input } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

export function SystemDependencyInstallPanel(props: {
  job: SystemDependencyInstallJobSnapshot;
  output: string;
  submitting: boolean;
  onSubmitInput: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const t = useTranslation();
  const [value, setValue] = useState("");
  const showInput =
    props.job.interaction.kind === "sudo_password" || props.job.interaction.kind === "confirm";
  const label =
    props.job.interaction.kind === "confirm"
      ? (props.job.interaction.promptExcerpt ?? t("system_deps.install.submit_input"))
      : t("system_deps.install.password_label");
  const currentStep = props.job.steps.find((step) => step.id === props.job.currentStepId);
  const failureCodeLabel = props.job.failure
    ? t(`system_deps.install.failure.${props.job.failure.code}`)
    : null;
  const failureDetails =
    props.job.failure?.stderrExcerpt ?? props.job.failure?.stdoutExcerpt ?? undefined;

  return (
    <div className="diagnostics-install-panel">
      <div className="diagnostics-install-panel__meta">
        <span>
          {t("system_deps.install.package_manager")}: {props.job.packageManager ?? "—"}
        </span>
        <span>{t(`system_deps.install.status.${props.job.status}`)}</span>
      </div>

      {currentStep ? (
        <div className="diagnostics-install-panel__meta">
          <span>
            {t("system_deps.install.current_step")}: {t(currentStep.titleKey)}
          </span>
        </div>
      ) : null}

      {props.job.failure ? (
        <div className="diagnostics-install-panel__meta">
          <span>
            {t("system_deps.install.failure_reason")}:{" "}
            {failureCodeLabel === `system_deps.install.failure.${props.job.failure.code}`
              ? props.job.failure.message
              : failureCodeLabel}
          </span>
        </div>
      ) : null}

      {props.job.failure?.message ? (
        <div className="diagnostics-install-panel__meta">
          <span>{props.job.failure.message}</span>
        </div>
      ) : null}

      {failureDetails ? (
        <div className="diagnostics-install-panel__meta">
          <span>
            {t("system_deps.install.failure_details")}: {failureDetails}
          </span>
        </div>
      ) : null}

      <pre className="diagnostics-install-panel__log">{props.output}</pre>

      {showInput ? (
        <form
          className="diagnostics-install-panel__prompt"
          data-testid="system-dependency-password-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value) {
              return;
            }
            void props.onSubmitInput(`${value}\n`);
            setValue("");
          }}
        >
          <label className="diagnostics-install-panel__label" htmlFor="system-dependency-input">
            {label}
          </label>
          <Input
            id="system-dependency-input"
            className="diagnostics-install-panel__input"
            type={props.job.interaction.echo ? "text" : "password"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="diagnostics-install-panel__actions">
            <Button loading={props.submitting} size="sm" type="submit" variant="primary">
              {t(
                props.job.interaction.kind === "sudo_password"
                  ? "system_deps.install.submit_password"
                  : "system_deps.install.submit_input"
              )}
            </Button>
            <Button
              onClick={() => {
                void props.onCancel();
              }}
              size="sm"
              variant="ghost"
            >
              {t("system_deps.install.cancel")}
            </Button>
          </div>
        </form>
      ) : props.job.status === "queued" ||
        props.job.status === "running" ||
        props.job.status === "waiting_input" ? (
        <div className="diagnostics-install-panel__actions">
          <Button
            onClick={() => {
              void props.onCancel();
            }}
            size="sm"
            variant="ghost"
          >
            {t("system_deps.install.cancel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
