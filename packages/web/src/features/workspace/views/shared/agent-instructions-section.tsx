import type { AgentInstructionsSystemStatusEntry } from "@coder-studio/core";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { type FC, useState } from "react";
import { Button, IconButton, Notice, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useAgentInstructionsActions } from "../../actions/use-agent-instructions-actions";
import { AgentInstructionsGenerateDialog } from "./agent-instructions-generate-dialog";

interface AgentInstructionsSectionProps {
  workspaceId: string;
}

function getSystemStatusLabel(
  entry: AgentInstructionsSystemStatusEntry,
  t: (key: string) => string
): string {
  if (entry.status === "ready") {
    return t("workspace.agent_instructions.system_status.ready");
  }
  if (entry.status === "missing") {
    return t("workspace.agent_instructions.system_status.missing");
  }
  if (entry.status === "unsupported") {
    return t("workspace.agent_instructions.system_status.unsupported");
  }

  return t("workspace.agent_instructions.system_status.error");
}

export const AgentInstructionsSection: FC<AgentInstructionsSectionProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const {
    busyAction,
    closeGenerateDialog,
    editCustom,
    editSystem,
    error,
    generationDialog,
    loading,
    openGenerateDialog,
    setExpanded,
    setGenerateDialogModel,
    setGenerateDialogProviderId,
    status,
    submitGenerateDialog,
    workspace,
  } = useAgentInstructionsActions(workspaceId);

  const projectTitle = t("workspace.agent_instructions.project_title");
  const systemTitle = t("workspace.agent_instructions.system_title");
  const panelTitle = projectTitle;
  const isExpanded = workspace?.uiState.agentInstructionsExpanded ?? true;
  const projectStatus = status?.project ?? status?.document;
  const systemStatus = status?.system ?? [];
  const isEmpty = !loading && status !== null && !projectStatus?.exists;
  const isRegenerating = busyAction === "generate" && Boolean(projectStatus?.exists);
  const [isSystemExpanded, setSystemExpanded] = useState(true);
  const systemPanelId = `agent-instructions-system-${workspaceId}`;
  const toggleLabel = isExpanded
    ? t("workspace.agent_instructions.collapse_label")
    : t("workspace.agent_instructions.expand_label");
  const systemToggleLabel = isSystemExpanded
    ? t("workspace.agent_instructions.system_collapse_label")
    : t("workspace.agent_instructions.system_expand_label");
  const statusLabel = !projectStatus?.exists
    ? t("workspace.agent_instructions.status.missing")
    : isRegenerating
      ? t("workspace.agent_instructions.status.regenerating")
      : projectStatus.stale
        ? t("workspace.agent_instructions.status.stale")
        : t("workspace.agent_instructions.status.ready");

  return (
    <section className="workspace-sidebar-section workspace-agent-instructions">
      <div className="workspace-sidebar-section__header workspace-agent-instructions__header">
        <div className="workspace-sidebar-section__header-main workspace-agent-instructions__header-main">
          <Tooltip content={toggleLabel}>
            <IconButton
              aria-label={t("workspace.agent_instructions.toggle_expand")}
              aria-expanded={isExpanded}
              className="workspace-sidebar-section__chevron workspace-agent-instructions__toggle"
              icon={isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              onClick={() => {
                void setExpanded(!isExpanded);
              }}
              size="sm"
            />
          </Tooltip>
          <div className="workspace-agent-instructions__title-row">
            <h2 className="workspace-sidebar-section__title workspace-agent-instructions__title">
              {panelTitle}
            </h2>
            <Tooltip content={t("workspace.agent_instructions.summary_tooltip")}>
              <IconButton
                aria-label={t("workspace.agent_instructions.summary_help")}
                className="workspace-agent-instructions__title-help"
                icon={<Info size={12} />}
                size="sm"
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {isExpanded ? (
        <div className="workspace-agent-instructions__body">
          {error ? (
            <Notice className="workspace-agent-instructions__notice" message={error} tone="error" />
          ) : null}

          {status ? (
            <>
              <div className="workspace-agent-instructions__group">
                <div className="workspace-agent-instructions__status" aria-label={projectTitle}>
                  <div className="workspace-agent-instructions__status-main">
                    <span className="workspace-agent-instructions__status-pill">{statusLabel}</span>
                    {isEmpty ? (
                      <div className="workspace-agent-instructions__inline-actions">
                        <Button
                          aria-label={t("workspace.agent_instructions.generate")}
                          className="workspace-agent-instructions__status-action"
                          loading={busyAction === "generate"}
                          onClick={() => {
                            void openGenerateDialog("generate");
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {t("workspace.agent_instructions.generate_short")}
                        </Button>
                        <Button
                          aria-label={t("workspace.agent_instructions.edit")}
                          className="workspace-agent-instructions__status-action"
                          loading={busyAction === "edit"}
                          onClick={() => {
                            void editCustom();
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {t("workspace.agent_instructions.edit_short")}
                        </Button>
                      </div>
                    ) : !loading && !isEmpty ? (
                      <div className="workspace-agent-instructions__inline-actions">
                        <Button
                          aria-label={t("workspace.agent_instructions.regenerate")}
                          className="workspace-agent-instructions__status-action"
                          loading={busyAction === "generate"}
                          onClick={() => {
                            void openGenerateDialog("regenerate");
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {t("workspace.agent_instructions.regenerate_short")}
                        </Button>
                        <Button
                          aria-label={t("workspace.agent_instructions.edit")}
                          className="workspace-agent-instructions__status-action"
                          loading={busyAction === "edit"}
                          onClick={() => {
                            void editCustom();
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {t("workspace.agent_instructions.edit_short")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {systemStatus.length > 0 ? (
                <div className="workspace-agent-instructions__group">
                  <div className="workspace-agent-instructions__group-header">
                    <div className="workspace-sidebar-section__header-main workspace-agent-instructions__group-header-main">
                      <Tooltip content={systemToggleLabel}>
                        <IconButton
                          aria-controls={systemPanelId}
                          aria-expanded={isSystemExpanded}
                          aria-label={systemToggleLabel}
                          className="workspace-sidebar-section__chevron workspace-agent-instructions__group-toggle"
                          icon={
                            isSystemExpanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )
                          }
                          onClick={() => {
                            setSystemExpanded((current) => !current);
                          }}
                          size="sm"
                        />
                      </Tooltip>
                      <div className="workspace-agent-instructions__title-row">
                        <h3 className="workspace-sidebar-section__title workspace-agent-instructions__group-title">
                          {systemTitle}
                        </h3>
                        <Tooltip content={t("workspace.agent_instructions.system_tooltip")}>
                          <IconButton
                            aria-label={t("workspace.agent_instructions.system_help")}
                            className="workspace-agent-instructions__title-help"
                            icon={<Info size={12} />}
                            size="sm"
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                  {isSystemExpanded ? (
                    <div className="workspace-agent-instructions__system-list" id={systemPanelId}>
                      {systemStatus.map((entry) => (
                        <div
                          className="workspace-agent-instructions__system-row"
                          key={entry.providerId}
                        >
                          <div className="workspace-agent-instructions__system-main">
                            <span className="workspace-agent-instructions__system-name">
                              {entry.displayName}
                            </span>
                            <span className="workspace-agent-instructions__system-path">
                              {entry.displayPath}
                            </span>
                          </div>
                          <span className="workspace-agent-instructions__system-status">
                            {getSystemStatusLabel(entry, t)}
                          </span>
                          {entry.editable ? (
                            <Button
                              aria-label={t("workspace.agent_instructions.system_edit", {
                                name: entry.displayName,
                              })}
                              className="workspace-agent-instructions__status-action"
                              loading={busyAction === "edit"}
                              onClick={() => {
                                void editSystem(entry);
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              {t("workspace.agent_instructions.edit_short")}
                            </Button>
                          ) : (
                            <span className="workspace-agent-instructions__system-unsupported">
                              {t("workspace.agent_instructions.system_unsupported")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {!isEmpty && !status ? (
            <p className="workspace-agent-instructions__state">{t("common.loading")}</p>
          ) : null}

          <AgentInstructionsGenerateDialog
            error={null}
            loading={false}
            mode={generationDialog?.mode ?? "generate"}
            model={generationDialog?.model ?? ""}
            open={generationDialog?.open ?? false}
            providerId={generationDialog?.providerId ?? ""}
            providerOptions={generationDialog?.options ?? []}
            onClose={closeGenerateDialog}
            onModelChange={setGenerateDialogModel}
            onProviderChange={setGenerateDialogProviderId}
            onSubmit={submitGenerateDialog}
          />
        </div>
      ) : null}
    </section>
  );
};
