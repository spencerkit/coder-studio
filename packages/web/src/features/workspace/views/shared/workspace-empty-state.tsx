import type { ReactNode } from "react";
import { EmptyState } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface WorkspaceEmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
}

interface WorkspaceResolvingStateShellProps {
  title: ReactNode;
  description: ReactNode;
  testId?: string;
}

const workspaceResolvingEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: 0,
  alignItems: "stretch",
  justifyContent: "flex-start",
  textAlign: "left",
};

export function WorkspaceResolvingStateShell({
  title,
  description,
  testId,
}: WorkspaceResolvingStateShellProps) {
  const t = useTranslation();

  return (
    <div className="workspace-resolving-shell" data-testid={testId}>
      <div className="workspace-resolving-card">
        <EmptyState
          style={workspaceResolvingEmptyStateStyle}
          title={
            <div>
              <div className="workspace-resolving-kicker">{t("workspace.title")}</div>
              <div className="workspace-resolving-title">{title}</div>
            </div>
          }
          description={<div className="workspace-resolving-desc">{description}</div>}
        />
      </div>
    </div>
  );
}

export function WorkspaceEmptyState({ title, description }: WorkspaceEmptyStateProps) {
  const t = useTranslation();

  return (
    <WorkspaceResolvingStateShell
      title={title ?? t("workspace.load_failed_title")}
      description={description ?? t("workspace.load_failed_description")}
    />
  );
}
