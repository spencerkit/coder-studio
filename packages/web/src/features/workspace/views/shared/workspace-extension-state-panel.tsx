import type {
  WorkspaceLogEntryView,
  WorkspaceProgressView,
  WorkspaceQuickActionView,
  WorkspaceStatusPillView,
} from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { Play } from "lucide-react";
import { type FC, type ReactNode, useMemo, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms";
import {
  EmptyState,
  IconButton,
  Notice,
  ProgressBar,
  Tag,
  Tooltip,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { workspaceExtensionStateAtomFamily } from "../../atoms/extension-state";

interface WorkspaceExtensionStatePanelProps {
  workspaceId: string;
}

const statusColorByState: Record<
  WorkspaceStatusPillView["state"],
  "neutral" | "blue" | "green" | "amber" | "pink"
> = {
  idle: "neutral",
  running: "blue",
  success: "green",
  warning: "amber",
  error: "pink",
};

const logColorByLevel: Record<WorkspaceLogEntryView["level"], "blue" | "amber" | "pink"> = {
  info: "blue",
  warning: "amber",
  error: "pink",
};

function hasBoundedProgress(
  progress: WorkspaceProgressView
): progress is WorkspaceProgressView & { value: number; max: number } {
  return (
    typeof progress.value === "number" &&
    Number.isFinite(progress.value) &&
    typeof progress.max === "number" &&
    Number.isFinite(progress.max) &&
    progress.max > 0
  );
}

function WorkspaceExtensionSection({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count: number;
  title: string;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <section className="workspace-sidebar-section workspace-extension-state-panel__section">
      <div className="workspace-sidebar-section__header">
        <div className="workspace-sidebar-section__header-main">
          <h3 className="workspace-sidebar-section__title">{title}</h3>
          <span className="workspace-sidebar-section__count">{count}</span>
        </div>
      </div>
      <div className="workspace-extension-state-panel__section-body">{children}</div>
    </section>
  );
}

function StatusPillRow({ pill }: { pill: WorkspaceStatusPillView }) {
  return (
    <div className="workspace-extension-state-panel__row workspace-sidebar-row">
      <div className="workspace-extension-state-panel__row-main">
        <span className="workspace-extension-state-panel__row-title">{pill.label}</span>
        {pill.detail ? (
          <span className="workspace-extension-state-panel__row-detail">{pill.detail}</span>
        ) : null}
      </div>
      <Tag
        caps={false}
        className="workspace-extension-state-panel__tag"
        color={statusColorByState[pill.state]}
        size="sm"
      >
        {pill.state}
      </Tag>
    </div>
  );
}

function ProgressRow({
  progress,
  valueLabel,
}: {
  progress: WorkspaceProgressView;
  valueLabel: string | null;
}) {
  const bounded = hasBoundedProgress(progress);

  return (
    <div className="workspace-extension-state-panel__progress-row workspace-sidebar-row">
      <div className="workspace-extension-state-panel__row-head">
        <span className="workspace-extension-state-panel__row-title">{progress.label}</span>
        {valueLabel ? (
          <span className="workspace-extension-state-panel__meta">{valueLabel}</span>
        ) : null}
      </div>
      <ProgressBar
        aria-label={progress.label}
        indeterminate={!bounded}
        max={bounded ? progress.max : 1}
        tone="info"
        value={bounded ? progress.value : 0}
      />
      {progress.detail ? (
        <span className="workspace-extension-state-panel__row-detail">{progress.detail}</span>
      ) : null}
    </div>
  );
}

function LogRow({ entry }: { entry: WorkspaceLogEntryView }) {
  return (
    <div className="workspace-extension-state-panel__log-row workspace-sidebar-row">
      <Tag caps={false} color={logColorByLevel[entry.level]} size="sm">
        {entry.level}
      </Tag>
      <span className="workspace-extension-state-panel__log-message">{entry.message}</span>
    </div>
  );
}

function QuickActionRow({
  action,
  onRun,
}: {
  action: WorkspaceQuickActionView;
  onRun: (action: WorkspaceQuickActionView) => void;
}) {
  return (
    <div className="workspace-extension-state-panel__quick-action workspace-sidebar-row">
      <div className="workspace-extension-state-panel__row-main">
        <span className="workspace-extension-state-panel__row-title">{action.label}</span>
        {action.description ? (
          <span className="workspace-extension-state-panel__row-detail">{action.description}</span>
        ) : null}
      </div>
      <Tooltip content={action.label}>
        <IconButton
          aria-label={action.label}
          className="workspace-extension-state-panel__quick-action-button"
          icon={<Play size={14} />}
          onClick={() => onRun(action)}
          size="sm"
        />
      </Tooltip>
    </div>
  );
}

export const WorkspaceExtensionStatePanel: FC<WorkspaceExtensionStatePanelProps> = ({
  workspaceId,
}) => {
  const t = useTranslation();
  const state = useAtomValue(workspaceExtensionStateAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [actionError, setActionError] = useState<string | null>(null);
  const totalContributions =
    state.statusPills.length +
    state.progress.length +
    state.logs.length +
    state.quickActions.length;

  const progressValueLabels = useMemo(() => {
    const labels = new Map<string, string | null>();
    for (const progress of state.progress) {
      labels.set(
        progress.key,
        hasBoundedProgress(progress)
          ? t("workspace.extensions.progress_value", {
              value: progress.value,
              max: progress.max,
            })
          : null
      );
    }
    return labels;
  }, [state.progress, t]);

  const handleRunQuickAction = (action: WorkspaceQuickActionView) => {
    setActionError(null);
    void dispatch(action.command, { workspaceId, actionId: action.id }).then((result) => {
      if (!result.ok) {
        setActionError(result.error?.message ?? t("workspace.extensions.action_failed"));
      }
    });
  };

  return (
    <div className="workspace-sidebar-view workspace-extension-state-panel">
      <div className="workspace-sidebar-panel__body workspace-extension-state-panel__body">
        <section className="workspace-sidebar-section workspace-extension-state-panel__summary">
          <div className="workspace-sidebar-section__header">
            <div className="workspace-sidebar-section__header-main">
              <h2 className="workspace-sidebar-section__title workspace-extension-state-panel__title">
                {t("workspace.extensions.title")}
              </h2>
              {totalContributions > 0 ? (
                <span className="workspace-sidebar-section__count">{totalContributions}</span>
              ) : null}
            </div>
          </div>
          {actionError ? (
            <Notice
              className="workspace-extension-state-panel__notice"
              message={actionError}
              tone="error"
            />
          ) : null}
          {totalContributions === 0 ? (
            <EmptyState
              className="workspace-extension-state-panel__empty"
              description={t("workspace.extensions.empty_body")}
              style={{
                alignItems: "flex-start",
                justifyContent: "flex-start",
                minHeight: "auto",
                padding: "var(--sp-3) 0 0",
                textAlign: "left",
              }}
              title={t("workspace.extensions.empty_title")}
            />
          ) : null}
        </section>

        <WorkspaceExtensionSection
          count={state.statusPills.length}
          title={t("workspace.extensions.status_title")}
        >
          {state.statusPills.map((pill) => (
            <StatusPillRow key={pill.key} pill={pill} />
          ))}
        </WorkspaceExtensionSection>

        <WorkspaceExtensionSection
          count={state.progress.length}
          title={t("workspace.extensions.progress_title")}
        >
          {state.progress.map((progress) => (
            <ProgressRow
              key={progress.key}
              progress={progress}
              valueLabel={progressValueLabels.get(progress.key) ?? null}
            />
          ))}
        </WorkspaceExtensionSection>

        <WorkspaceExtensionSection
          count={state.logs.length}
          title={t("workspace.extensions.logs_title")}
        >
          {state.logs.map((entry) => (
            <LogRow key={`${entry.key}-${entry.timestamp}-${entry.message}`} entry={entry} />
          ))}
        </WorkspaceExtensionSection>

        <WorkspaceExtensionSection
          count={state.quickActions.length}
          title={t("workspace.extensions.quick_actions_title")}
        >
          {state.quickActions.map((action) => (
            <QuickActionRow key={action.id} action={action} onRun={handleRunQuickAction} />
          ))}
        </WorkspaceExtensionSection>
      </div>
    </div>
  );
};
