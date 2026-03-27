import type { Translator } from "../../i18n";
import type { ExecTarget } from "../../state/workbench";

export type RuntimeRequirementId = "claude" | "git";

export type RuntimeRequirementStatus = {
  id: RuntimeRequirementId;
  command: string;
  available: boolean | null;
  resolvedPath?: string;
  error?: string;
  detailText?: string;
};

export type RuntimeValidationState = {
  status: "idle" | "checking" | "ready" | "failed";
  targetKey: string;
  requirements: RuntimeRequirementStatus[];
};

type RuntimeValidationOverlayProps = {
  visible: boolean;
  target: ExecTarget;
  canUseWsl: boolean;
  runtimeLabel: string;
  validation: RuntimeValidationState;
  onUpdateTarget: (target: ExecTarget) => void;
  onRetry: () => void;
  t: Translator;
};

const requirementCopy = (id: RuntimeRequirementId, t: Translator) => {
  if (id === "claude") {
    return {
      label: t("runtimeCheckClaudeLabel"),
      hint: t("runtimeCheckClaudeHint"),
    };
  }

  return {
    label: t("runtimeCheckGitLabel"),
    hint: t("runtimeCheckGitHint"),
  };
};

export const RuntimeValidationOverlay = ({
  visible,
  target,
  canUseWsl,
  runtimeLabel,
  validation,
  onUpdateTarget,
  onRetry,
  t,
}: RuntimeValidationOverlayProps) => {
  if (!visible) return null;

  const summaryDescription = validation.status === "failed"
    ? t("runtimeCheckMissingDescription", { runtime: runtimeLabel })
    : t("runtimeCheckCheckingDescription", { runtime: runtimeLabel });
  const retryDisabled = validation.status !== "failed";

  return (
    <div className="overlay" data-testid="runtime-validation-overlay" data-density="compact">
      <div className="modal onboarding-modal">
        <div className="onboarding-form runtime-check-shell">
          <div className="onboarding-header">
            <h2>{t("runtimeCheckTitle")}</h2>
            <p>{t("runtimeCheckDescription")}</p>
          </div>

          {canUseWsl && (
            <div className="choice-grid small">
              <div
                className={`choice ${target.type === "native" ? "active" : ""}`}
                onClick={() => onUpdateTarget({ type: "native" })}
              >
                <strong>{t("nativeTarget")}</strong>
                <div className="hint">{t("nativeTargetHint")}</div>
              </div>
              <div
                className={`choice ${target.type === "wsl" ? "active" : ""}`}
                onClick={() => onUpdateTarget({ type: "wsl" })}
              >
                <strong>WSL</strong>
                <div className="hint">{t("wslHint")}</div>
              </div>
            </div>
          )}

          {canUseWsl && target.type === "wsl" && (
            <input
              value={target.distro ?? ""}
              onChange={(event) => onUpdateTarget({ type: "wsl", distro: event.target.value })}
              placeholder={t("optionalDistroPlaceholder")}
            />
          )}

          <div className="runtime-check-summary">
            <div className="section-kicker">{t("runtimeCheckRequiredTitle")}</div>
            <strong>{runtimeLabel}</strong>
            <p>{summaryDescription}</p>
          </div>

          <div className="runtime-check-list" role="status" aria-live="polite">
            {validation.requirements.map((requirement) => {
              const copy = requirementCopy(requirement.id, t);
              const stateClass = requirement.available === true
                ? "available"
                : requirement.available === false
                  ? "missing"
                  : "checking";
              const detailText = requirement.detailText || (requirement.available === true
                ? (requirement.resolvedPath
                    ? t("launchCommandResolvedPath", { path: requirement.resolvedPath })
                    : copy.hint)
                : requirement.available === false
                  ? (requirement.error || copy.hint)
                  : copy.hint);

              return (
                <div key={requirement.id} className={`settings-inline-status ${stateClass}`}>
                  <span className="settings-inline-status-dot" />
                  <div className="settings-inline-status-copy">
                    <span>{copy.label}</span>
                    <small>{detailText}</small>
                  </div>
                </div>
              );
            })}
          </div>

          {validation.status === "failed" && (
            <div className="folder-browser-notice runtime-check-note">
              {t("runtimeCheckInstallHint")}
            </div>
          )}

          <div className="modal-actions">
            <button
              className="btn primary"
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
            >
              {retryDisabled ? t("runtimeCheckChecking") : t("runtimeCheckRetry")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RuntimeValidationOverlay;
