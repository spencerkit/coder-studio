import type {
  LspEnsureSessionResult,
  LspToolInstallJobSnapshot,
  LspToolInstallStepSnapshot,
} from "@coder-studio/core";
import { Button, Notice } from "../../../components/ui";

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

function describeStep(step: LspToolInstallStepSnapshot | undefined): string | null {
  if (!step) {
    return null;
  }

  if (step.status === "running") {
    return `Installing: ${step.title}`;
  }

  if (step.status === "failed") {
    return `Install failed at: ${step.title}`;
  }

  return null;
}

export function LspStatusNotice({
  state,
  onInstall,
  onRetry,
  installing = false,
}: LspStatusNoticeProps) {
  const activeStep = state.installJob?.steps.find(
    (step) => step.id === state.installJob?.currentStepId
  );
  const progressMessage = describeStep(activeStep);
  const canInstall =
    state.kind === "tool_missing" &&
    state.autoInstallSupported &&
    state.missingPrerequisites.length === 0 &&
    onInstall;
  const canRetry = state.kind === "failed" && onRetry;

  const action = canInstall ? (
    <Button onClick={onInstall} loading={installing} size="sm">
      Install
    </Button>
  ) : canRetry ? (
    <Button onClick={onRetry} size="sm" variant="ghost">
      Retry
    </Button>
  ) : null;

  return (
    <Notice
      tone={state.kind === "failed" ? "warning" : "info"}
      title={`${state.displayName} unavailable`}
      message={progressMessage ?? state.message}
      action={action}
    />
  );
}
