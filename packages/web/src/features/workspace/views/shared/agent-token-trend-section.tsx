import { ChevronDown, ChevronRight } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { buildWorkAnalyticsPath } from "../../../work-analysis/navigation";
import { AgentInstructionsTokenTrend } from "./agent-instructions-token-trend";

interface AgentTokenTrendSectionProps {
  workspaceId: string;
  workspacePath: string;
}

export const AgentTokenTrendSection: FC<AgentTokenTrendSectionProps> = ({
  workspaceId,
  workspacePath,
}) => {
  const t = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const panelId = "workspace-agent-token-trend-panel";
  const toggleLabel = isExpanded
    ? t("workspace.agent_instructions.token_trend.collapse_label")
    : t("workspace.agent_instructions.token_trend.expand_label");
  const navigate = useNavigate();

  return (
    <section className="workspace-sidebar-section workspace-agent-token-trend-section">
      <div className="workspace-sidebar-section__header">
        <div className="workspace-sidebar-section__header-main">
          <Tooltip content={toggleLabel}>
            <IconButton
              aria-controls={panelId}
              aria-expanded={isExpanded}
              aria-label={toggleLabel}
              className="workspace-sidebar-section__chevron"
              icon={isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              onClick={() => setIsExpanded((current) => !current)}
              size="sm"
            />
          </Tooltip>
          <h2 className="workspace-sidebar-section__title">
            {t("workspace.agent_instructions.token_trend.title")}
          </h2>
        </div>
        <div className="workspace-sidebar-panel__actions workspace-sidebar-section__actions">
          <Button
            className="workspace-agent-token-trend-section__more-data"
            onClick={() =>
              navigate(
                buildWorkAnalyticsPath({
                  workspacePaths: [workspacePath],
                })
              )
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("workspace.agent_instructions.token_trend.more_data")}
          </Button>
        </div>
      </div>
      {isExpanded ? (
        <div id={panelId}>
          <AgentInstructionsTokenTrend workspaceId={workspaceId} workspacePath={workspacePath} />
        </div>
      ) : null}
    </section>
  );
};
