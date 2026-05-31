import type {
  LspEnsureSessionResult,
  LspToolInstallJobSnapshot,
  LspToolInstallStepSnapshot,
} from "@coder-studio/core";
import { Button, Notice } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

type LspNoticeState = Exclude<
  LspEnsureSessionResult,
  { kind: "ready" | "unsupported_language" }
> & {
  installJob?: LspToolInstallJobSnapshot;
};

interface LspStatusNoticeProps {
  state: LspNoticeState;
  onInstall?: () => void;
  onRetry?: () => void;
  installing?: boolean;
}

function describeStep(
  step: LspToolInstallStepSnapshot | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (!step) {
    return null;
  }

  if (step.status === "running") {
    return t("code_editor.lsp_installing_step", { title: step.title });
  }

  if (step.status === "failed") {
    return t("code_editor.lsp_install_failed_step", { title: step.title });
  }

  return null;
}

function getLspMessage(
  state: LspNoticeState,
  progressMessage: string | null,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (progressMessage) {
    return progressMessage;
  }

  if (state.kind === "installing" && state.errorCode === "lsp_install_in_progress") {
    return t("code_editor.lsp_install_in_progress");
  }

  if (state.kind === "failed" && state.errorCode === "lsp_install_failed") {
    return state.message || t("code_editor.lsp_install_failed");
  }

  return state.message;
}

export function LspStatusNotice({
  state,
  onInstall,
  onRetry,
  installing = false,
}: LspStatusNoticeProps) {
  const t = useTranslation();

  if (state.kind === "disabled") {
    return (
      <Notice
        tone="info"
        title={t("code_editor.lsp_disabled_title")}
        message={t("code_editor.lsp_disabled_message")}
      />
    );
  }

  const activeStep = state.installJob?.steps.find(
    (step) => step.id === state.installJob?.currentStepId
  );
  const progressMessage = describeStep(activeStep, t);
  const canInstall =
    state.kind === "tool_missing" &&
    state.autoInstallSupported &&
    state.missingPrerequisites.length === 0 &&
    onInstall;
  const canRetry = state.kind === "failed" && onRetry;

  const action = canInstall ? (
    <Button onClick={onInstall} loading={installing} size="sm">
      {t("code_editor.lsp_install")}
    </Button>
  ) : canRetry ? (
    <Button onClick={onRetry} size="sm" variant="ghost">
      {t("action.retry")}
    </Button>
  ) : null;

  return (
    <Notice
      tone={state.kind === "failed" ? "warning" : "info"}
      title={t("code_editor.lsp_unavailable", { name: state.displayName })}
      message={getLspMessage(state, progressMessage, t)}
      action={action}
    />
  );
}
