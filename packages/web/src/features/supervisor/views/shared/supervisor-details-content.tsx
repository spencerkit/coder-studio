import type { SupervisorPlanNode, SupervisorPlanNodeStatus } from "@coder-studio/core";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, IconButton, Tag, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { formatProviderLabel } from "../../../notifications/format";
import { useSupervisorActions } from "../../actions/use-supervisor-actions";
import { SupervisorMindMapFlow } from "./supervisor-mind-map-flow";
import { findPlanNodePath } from "./supervisor-mind-map-graph";

const PLAN_NODE_STATUS_TAG_COLOR: Record<
  SupervisorPlanNodeStatus,
  "blue" | "green" | "amber" | "neutral"
> = {
  blocked: "amber",
  done: "green",
  in_progress: "blue",
  pending: "neutral",
};

interface SupervisorDetailsContentProps {
  sessionId: string;
  workspaceId: string;
  onEdit: () => void;
  showInlineEdit?: boolean;
}

interface SupervisorSelectedNodeDetailProps {
  node: SupervisorPlanNode;
  rootId: string;
  rootTitle: string;
  onClear: () => void;
}

function SupervisorSelectedNodeDetail({
  node,
  onClear,
  rootId,
  rootTitle,
}: SupervisorSelectedNodeDetailProps) {
  const t = useTranslation();
  const title = node.id === rootId ? rootTitle : node.title;

  return (
    <div className="supervisor-node-detail supervisor-details-surface">
      <div className="supervisor-node-detail__header">
        <div className="supervisor-node-detail__heading-copy">
          <h3 className="supervisor-details-card-title">
            {t("supervisor.target_memory.node_detail_title")}
          </h3>
          <p className="supervisor-node-detail__title">{title}</p>
        </div>
        <Tooltip content={t("supervisor.target_memory.node_detail_close")}>
          <IconButton
            aria-label={t("supervisor.target_memory.node_detail_close")}
            className="supervisor-node-detail__close"
            icon={<X size={14} />}
            onClick={onClear}
            size="sm"
          />
        </Tooltip>
      </div>

      <div className="supervisor-node-detail__tags">
        <Tag color={PLAN_NODE_STATUS_TAG_COLOR[node.status]} size="sm" caps={false}>
          {t(`supervisor.target_memory.step_status.${node.status}`)}
        </Tag>
        {node.children.length ? (
          <span className="supervisor-node-detail__child-count">
            {t("supervisor.target_memory.child_count", { count: node.children.length })}
          </span>
        ) : null}
      </div>

      <dl className="supervisor-node-detail__body">
        <div className="supervisor-node-detail__item">
          <dt className="supervisor-node-detail__label">
            {t("supervisor.target_memory.node_detail_objective_title")}
          </dt>
          <dd className="supervisor-node-detail__value">
            <p className="supervisor-node-detail__text">{node.objective}</p>
          </dd>
        </div>
        <div className="supervisor-node-detail__item">
          <dt className="supervisor-node-detail__label">
            {t("supervisor.target_memory.node_detail_deliverable_title")}
          </dt>
          <dd className="supervisor-node-detail__value">
            <p className="supervisor-node-detail__text">{node.deliverable}</p>
          </dd>
        </div>
        {node.acceptanceCriteria.length ? (
          <div className="supervisor-node-detail__item">
            <dt className="supervisor-node-detail__label">
              {t("supervisor.target_memory.node_detail_acceptance_title")}
            </dt>
            <dd className="supervisor-node-detail__value">
              <ul className="supervisor-node-detail__list">
                {node.acceptanceCriteria.map((criterion, index) => (
                  <li key={`${index}-${criterion}`}>{criterion}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {node.readyCheck ? (
          <div className="supervisor-node-detail__item">
            <dt className="supervisor-node-detail__label">
              {t("supervisor.target_memory.node_detail_ready_check_title")}
            </dt>
            <dd className="supervisor-node-detail__value">
              <div className="supervisor-node-detail__inline-meta">
                <Tag color="blue" size="sm" caps={false}>
                  {t(
                    `supervisor.target_memory.ready_check_granularity.${node.readyCheck.granularity}`
                  )}
                </Tag>
                <span>{node.readyCheck.reason}</span>
              </div>
              {node.readyCheck.recommendedUnit ? (
                <p className="supervisor-node-detail__text">
                  {t("supervisor.target_memory.node_detail_recommended_unit")}:{" "}
                  {node.readyCheck.recommendedUnit}
                </p>
              ) : null}
              {node.readyCheck.qualityRisk ? (
                <p className="supervisor-node-detail__text">
                  {t("supervisor.target_memory.node_detail_quality_risk")}:{" "}
                  {node.readyCheck.qualityRisk}
                </p>
              ) : null}
              {node.readyCheck.missingInputs?.length ? (
                <p className="supervisor-node-detail__text">
                  {t("supervisor.target_memory.node_detail_missing_inputs")}:{" "}
                  {node.readyCheck.missingInputs.join(", ")}
                </p>
              ) : null}
            </dd>
          </div>
        ) : null}
        {node.execution?.guidance ? (
          <div className="supervisor-node-detail__item">
            <dt className="supervisor-node-detail__label">
              {t("supervisor.target_memory.node_detail_guidance_title")}
            </dt>
            <dd className="supervisor-node-detail__value">
              <p className="supervisor-node-detail__text">{node.execution.guidance}</p>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function SupervisorDetailsContent({
  sessionId,
  onEdit,
  showInlineEdit = true,
}: SupervisorDetailsContentProps) {
  const t = useTranslation();
  const { supervisor, targetMemory } = useSupervisorActions({ sessionId });
  const [selectedPlanNodeId, setSelectedPlanNodeId] = useState<string | null>(null);
  const selectedPlanNodePath = useMemo(
    () =>
      targetMemory && selectedPlanNodeId
        ? findPlanNodePath(targetMemory.planTree, selectedPlanNodeId)
        : null,
    [selectedPlanNodeId, targetMemory]
  );
  const selectedPlanNode = selectedPlanNodePath?.[selectedPlanNodePath.length - 1] ?? null;

  useEffect(() => {
    if (selectedPlanNodeId && !selectedPlanNode) {
      setSelectedPlanNodeId(null);
    }
  }, [selectedPlanNode, selectedPlanNodeId]);

  const handleInspectPlanNode = useCallback((nodeId: string) => {
    setSelectedPlanNodeId(nodeId);
  }, []);

  const rootDetail =
    targetMemory?.progressSummary ||
    targetMemory?.planTree.deliverable ||
    targetMemory?.planTree.objective;

  if (!supervisor) {
    return null;
  }

  const completedCycles = supervisor.completedSupervisionCount;
  const cycleCap =
    supervisor.maxSupervisionCount > 0
      ? String(supervisor.maxSupervisionCount)
      : t("supervisor.meta.no_cap");
  const latestErrorCycle = supervisor.recentTargetCycles?.find((cycle) => cycle.result === "error");
  const evaluationError = latestErrorCycle?.errorReason ?? supervisor.errorReason ?? null;
  const runtimeStatus =
    supervisor.state === "error"
      ? "error"
      : supervisor.state === "evaluating" || supervisor.state === "injecting"
        ? "running"
        : "idle";

  return (
    <div
      className="supervisor-details"
      data-runtime-status={runtimeStatus}
      data-supervisor-state={supervisor.state}
      aria-label={t("supervisor.target_memory.title")}
    >
      <section className="supervisor-details-section supervisor-details-section--summary">
        <div
          className="supervisor-summary-card supervisor-details-surface"
          data-supervisor-state={supervisor.state}
        >
          {showInlineEdit ? (
            <div className="supervisor-details-card-header">
              <Button
                className="supervisor-details-edit-btn"
                onClick={onEdit}
                size="sm"
                variant="ghost"
              >
                {t("supervisor.action.edit_objective")}
              </Button>
            </div>
          ) : null}
          <div className="supervisor-meta-grid supervisor-meta-grid--inline">
            <div className="supervisor-meta-item supervisor-meta-item--evaluator">
              <p className="supervisor-meta-label">{t("supervisor.field.evaluator")}</p>
              <p className="supervisor-meta-value supervisor-meta-value--strong">
                {formatProviderLabel(supervisor.evaluatorProviderId)}
              </p>
            </div>
            <div className="supervisor-meta-item supervisor-meta-item--cycles">
              <p className="supervisor-meta-label">{t("supervisor.target_memory.cycles_title")}</p>
              <p className="supervisor-meta-value supervisor-meta-value--strong">
                {completedCycles} / {cycleCap}
              </p>
            </div>
            <div className="supervisor-meta-item supervisor-meta-item--runtime">
              <p className="supervisor-meta-label">
                {t("supervisor.target_memory.runtime_status_label")}
              </p>
              <p className="supervisor-meta-value supervisor-meta-value--strong">
                {t(`supervisor.target_memory.runtime_status.${runtimeStatus}`)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {runtimeStatus === "error" && evaluationError ? (
        <section className="supervisor-details-section supervisor-details-section--error">
          <div className="supervisor-details-surface supervisor-details-surface--error">
            <h3 className="supervisor-details-card-title">
              {t("supervisor.target_memory.error_reason_label")}
            </h3>
            <div className="supervisor-error" role="alert">
              {evaluationError}
            </div>
          </div>
        </section>
      ) : null}

      {targetMemory ? (
        <section className="supervisor-details-section supervisor-details-section--plan">
          <div className="supervisor-details-surface supervisor-details-surface--plan">
            <SupervisorMindMapFlow
              memory={targetMemory}
              onInspectNode={handleInspectPlanNode}
              rootDetail={rootDetail}
              rootTitle={supervisor.objective}
              selectedNodeId={selectedPlanNodeId}
            />
          </div>
        </section>
      ) : null}
      {targetMemory && selectedPlanNode ? (
        <section className="supervisor-details-section supervisor-details-section--node-detail supervisor-details-node-detail-region">
          <SupervisorSelectedNodeDetail
            node={selectedPlanNode}
            rootId={targetMemory.planTree.id}
            rootTitle={supervisor.objective}
            onClear={() => setSelectedPlanNodeId(null)}
          />
        </section>
      ) : null}
    </div>
  );
}
