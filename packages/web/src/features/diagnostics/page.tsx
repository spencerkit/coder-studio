import type {
  DiagnosticsCheck,
  DiagnosticsRequest,
  DiagnosticsResponse,
  Session,
  Workspace,
} from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { lastViewedTargetAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, dispatchCommandAtom } from "../../atoms/connection";
import { sessionsAtom } from "../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { Button, Notice, Tag, ThemedIcon } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import {
  defaultPaneLayout,
  type PaneNode,
  paneLayoutAtomFamily,
} from "../agent-panes/atoms/pane-layout";
import { assignSessionToPane } from "../agent-panes/pane-layout-tree";
import { MobilePageHeader } from "../shared/components/mobile-page-header";
import { PageHeader } from "../shared/components/page-header";
import { usePersistWorkspaceLastViewedTarget } from "../workspace/actions/use-persist-workspace-last-viewed-target";
import { useWorkspaceUiStatePersistence } from "../workspace/actions/use-workspace-ui-state-persistence";
import { parseDiagnosticsSearch } from "./navigation";

function getProviderLabel(providerId?: string): string {
  if (providerId === "claude") {
    return "Claude";
  }

  if (providerId === "codex") {
    return "Codex";
  }

  return providerId ?? "Provider";
}

function formatList(values: string[] | undefined): string {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "—";
}

function resolveMobileWorkspaceUrl(host: string | undefined): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return null;
  }

  const protocol =
    window.location.protocol === "https:" || window.location.protocol === "http:"
      ? window.location.protocol
      : "http:";
  const url = new URL(`${protocol}//${host}`);

  if (window.location.port) {
    url.port = window.location.port;
  }

  url.pathname = "/workspace";
  url.search = "";
  url.hash = "";

  return url.toString();
}

function buildCheckCopy(
  t: ReturnType<typeof useTranslation>,
  check: DiagnosticsCheck
): { title: string; description: string } {
  const provider = getProviderLabel(check.providerId);

  switch (check.code) {
    case "workspace_selection_missing":
      return {
        title: t("diagnostics.checks.workspace_selection_missing.title"),
        description: t("diagnostics.checks.workspace_selection_missing.description"),
      };
    case "workspace_path_ready":
      return {
        title: t("diagnostics.checks.workspace_path_ready.title"),
        description: t("diagnostics.checks.workspace_path_ready.description"),
      };
    case "workspace_path_not_found":
      return {
        title: t("diagnostics.checks.workspace_path_not_found.title"),
        description: t("diagnostics.checks.workspace_path_not_found.description"),
      };
    case "workspace_path_unreadable":
      return {
        title: t("diagnostics.checks.workspace_path_unreadable.title"),
        description: t("diagnostics.checks.workspace_path_unreadable.description"),
      };
    case "session_workspace_ready":
      return {
        title: t("diagnostics.checks.session_workspace_ready.title"),
        description: t("diagnostics.checks.session_workspace_ready.description"),
      };
    case "session_workspace_missing":
      return {
        title: t("diagnostics.checks.session_workspace_missing.title"),
        description: t("diagnostics.checks.session_workspace_missing.description"),
      };
    case "provider_runtime_ready":
      return {
        title: t("diagnostics.checks.provider_runtime_ready.title", { provider }),
        description: t("diagnostics.checks.provider_runtime_ready.description", { provider }),
      };
    case "provider_cli_missing":
      return {
        title: t("diagnostics.checks.provider_cli_missing.title", { provider }),
        description: t("diagnostics.checks.provider_cli_missing.description", { provider }),
      };
    case "provider_prerequisite_missing":
      return {
        title: t("diagnostics.checks.provider_prerequisite_missing.title", { provider }),
        description: t("diagnostics.checks.provider_prerequisite_missing.description", {
          provider,
        }),
      };
    case "provider_unknown":
      return {
        title: t("diagnostics.checks.provider_unknown.title"),
        description: t("diagnostics.checks.provider_unknown.description"),
      };
    case "server_auth_ready":
      return {
        title: t("diagnostics.checks.server_auth_ready.title"),
        description: t("diagnostics.checks.server_auth_ready.description"),
      };
    case "server_auth_not_required":
      return {
        title: t("diagnostics.checks.server_auth_not_required.title"),
        description: t("diagnostics.checks.server_auth_not_required.description"),
      };
    case "mobile_host_ready":
      return {
        title: t("diagnostics.checks.mobile_host_ready.title"),
        description: t("diagnostics.checks.mobile_host_ready.description"),
      };
    case "mobile_host_local_only":
      return {
        title: t("diagnostics.checks.mobile_host_local_only.title"),
        description: t("diagnostics.checks.mobile_host_local_only.description"),
      };
    case "mobile_auth_disabled":
      return {
        title: t("diagnostics.checks.mobile_auth_disabled.title"),
        description: t("diagnostics.checks.mobile_auth_disabled.description"),
      };
    default:
      return {
        title: check.code,
        description: check.code,
      };
  }
}

export function DiagnosticsPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const intent = parseDiagnosticsSearch(location.search);
  const store = useStore();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const lastViewedTarget = useAtomValue(lastViewedTargetAtom);
  const [response, setResponse] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const workspaceUiStateTargetId = intent.workspaceId ?? response?.metadata.workspaceId;
  const persistWorkspaceUiState = useWorkspaceUiStatePersistence(
    workspaceUiStateTargetId ?? "__workspace_empty__"
  );

  function buildNextPaneLayout(
    workspaceId: string,
    sessionId: string,
    paneId?: string,
    launchMode?: "assign" | "replace"
  ): PaneNode {
    const currentLayout = store.get(paneLayoutAtomFamily(workspaceId));

    if (launchMode === "assign" && paneId) {
      return assignSessionToPane(currentLayout ?? defaultPaneLayout, paneId, sessionId);
    }

    return {
      id: "root",
      type: "leaf",
      sessionId,
    };
  }

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const request: DiagnosticsRequest = {
    context: intent.context,
    workspaceId: intent.workspaceId,
    workspacePath: intent.workspacePath,
    providerId: intent.providerId,
  };

  const loadDiagnostics = async (op: "diagnostics.get" | "diagnostics.recheck") => {
    if (connectionStatus !== "connected") {
      return;
    }

    setLoading(true);
    setLoadError(null);

    const result = await dispatch<DiagnosticsResponse>(op, request);
    if (!result.ok || !result.data) {
      setResponse(null);
      setLoadError(result.error?.message ?? t("diagnostics.load_failed"));
      setLoading(false);
      return;
    }

    setResponse(result.data);
    setLoadError(null);
    setLoading(false);
  };

  useEffect(() => {
    void loadDiagnostics("diagnostics.get");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connectionStatus,
    intent.context,
    intent.providerId,
    intent.workspaceId,
    intent.workspacePath,
  ]);

  const handleCopyDetails = async () => {
    const payload = {
      intent,
      response,
      loadError,
      actionError,
      lastViewedTarget,
    };

    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopyConfirmed(true);

    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }

    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyConfirmed(false);
    }, 1500);
  };

  const handleContinueWorkspace = async () => {
    if (!intent.workspacePath) {
      return;
    }

    const result = await dispatch<Workspace>("workspace.open", {
      path: intent.workspacePath,
    });

    if (!result.ok || !result.data?.id) {
      setActionError(result.error?.message ?? t("workspace.launch.open_failed"));
      await loadDiagnostics("diagnostics.recheck");
      return;
    }

    await persistLastViewedTarget({ workspaceId: result.data.id });
    setActiveWorkspaceId(result.data.id);
    setWorkspaces((prev) => ({
      ...prev,
      [result.data!.id]: result.data!,
    }));
    setWorkspaceOrder((prev) => {
      if (prev.includes(result.data!.id)) {
        return prev;
      }
      return [result.data!.id, ...prev];
    });
    setWorkspacesLoadState("ready");
    setWorkspacesLoadError(null);
    navigate("/workspace");
  };

  const handleContinueSession = async () => {
    const workspaceId = intent.workspaceId ?? response?.metadata.workspaceId;
    const providerId = intent.providerId ?? response?.metadata.providerId;

    if (!workspaceId || !providerId) {
      setActionError(t("diagnostics.load_failed"));
      return;
    }

    const createResult = await dispatch<Session>("session.create", {
      workspaceId,
      providerId,
    });

    if (!createResult.ok || !createResult.data) {
      setActionError(createResult.error?.message ?? t("diagnostics.load_failed"));
      await loadDiagnostics("diagnostics.recheck");
      return;
    }

    setSessions((prev) => ({
      ...prev,
      [createResult.data!.id]: createResult.data!,
    }));

    setActiveWorkspaceId(workspaceId);
    setWorkspacesLoadState("ready");
    setWorkspacesLoadError(null);
    setWorkspaceOrder((prev) => (prev.includes(workspaceId) ? prev : [workspaceId, ...prev]));

    await persistLastViewedTarget({
      workspaceId,
      sessionId: createResult.data.id,
    });

    const nextLayout = buildNextPaneLayout(
      workspaceId,
      createResult.data.id,
      intent.paneId,
      intent.launchMode
    );

    store.set(paneLayoutAtomFamily(workspaceId), nextLayout);
    void persistWorkspaceUiState.persistUiState({
      activeSessionId: createResult.data.id,
      paneLayout: nextLayout,
    });

    navigate("/workspace");
  };

  const handleContinueOnPhone = async () => {
    const workspaceId = intent.workspaceId ?? response?.metadata.workspaceId;
    const sessionId =
      workspaceId && lastViewedTarget?.workspaceId === workspaceId
        ? (lastViewedTarget.sessionId ?? undefined)
        : undefined;

    if (workspaceId) {
      await persistLastViewedTarget({
        workspaceId,
        sessionId,
      });
    }

    const mobileUrl = resolveMobileWorkspaceUrl(response?.metadata.host);
    if (!mobileUrl) {
      setActionError(t("diagnostics.load_failed"));
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(mobileUrl);
      return;
    }

    setActionError(t("diagnostics.load_failed"));
  };

  const handlePrimaryAction = async () => {
    setActionError(null);

    if (intent.context === "workspace_open") {
      await handleContinueWorkspace();
      return;
    }

    if (intent.context === "session_start") {
      if (response?.canContinue) {
        await handleContinueSession();
        return;
      }

      await loadDiagnostics("diagnostics.recheck");
      return;
    }

    if (intent.context === "mobile_continue") {
      if (response?.canContinue) {
        await handleContinueOnPhone();
        return;
      }

      await loadDiagnostics("diagnostics.recheck");
      return;
    }

    await loadDiagnostics("diagnostics.recheck");
  };

  const getPrimaryActionLabel = () => {
    if (intent.context === "workspace_open") {
      return t("diagnostics.actions.retry_workspace");
    }

    if (intent.context === "session_start") {
      return response?.canContinue
        ? t("diagnostics.actions.continue_session")
        : t("diagnostics.actions.recheck");
    }

    if (intent.context === "mobile_continue") {
      return response?.canContinue
        ? t("diagnostics.actions.continue_phone")
        : t("diagnostics.actions.recheck");
    }

    return t("diagnostics.actions.recheck");
  };

  const canPrimaryContinue =
    intent.context === "workspace_open" ? Boolean(response?.canContinue) : true;

  const contextTitle = t(`diagnostics.context.${intent.context}.title`);
  const contextDescription = t(`diagnostics.context.${intent.context}.description`);
  const canCopyDetails =
    typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
  const handleBack = () => {
    navigate(-1);
  };

  return (
    <div className={`diagnostics-page ${isMobile ? "diagnostics-page--mobile" : ""}`}>
      <header className="diagnostics-header">
        {isMobile ? (
          <MobilePageHeader
            title={t("diagnostics.title")}
            titleAs="div"
            onBack={handleBack}
            backLabel={t("action.back")}
          />
        ) : (
          <PageHeader
            title={t("diagnostics.title")}
            titleAs="h1"
            level="secondary"
            onBack={handleBack}
            backLabel={t("action.back")}
          />
        )}
      </header>

      <div className={`diagnostics-body ${isMobile ? "diagnostics-body--mobile" : ""}`}>
        <main className={`diagnostics-content ${isMobile ? "diagnostics-content--mobile" : ""}`}>
          <div className="diagnostics-content-surface">
            <section
              className={`diagnostics-summary ${isMobile ? "diagnostics-summary--mobile" : ""}`}
            >
              <div className="diagnostics-summary__copy">
                {!isMobile ? (
                  <div className="diagnostics-summary__eyebrow">
                    <ThemedIcon semantic="state.warning" size={16} />
                    <span>{t("diagnostics.title")}</span>
                  </div>
                ) : null}
                {isMobile ? (
                  <h1 className="diagnostics-summary__title">{contextTitle}</h1>
                ) : (
                  <h2 className="diagnostics-summary__title">{contextTitle}</h2>
                )}
                <p className="diagnostics-summary__description">{contextDescription}</p>
              </div>
              <div
                className={`diagnostics-actions ${isMobile ? "diagnostics-actions--mobile" : ""}`}
              >
                <Button
                  className={isMobile ? "diagnostics-actions__primary" : undefined}
                  leadingIcon={<RefreshCw size={16} />}
                  loading={loading}
                  disabled={!canPrimaryContinue}
                  onClick={() => {
                    void handlePrimaryAction();
                  }}
                  variant="primary"
                >
                  {getPrimaryActionLabel()}
                </Button>
              </div>
            </section>

            {loadError || actionError ? (
              <Notice
                role="alert"
                tone="error"
                title={t("diagnostics.load_failed")}
                message={actionError ?? loadError ?? ""}
              />
            ) : null}

            <div className={`diagnostics-toolbar ${isMobile ? "diagnostics-toolbar--mobile" : ""}`}>
              {canCopyDetails ? (
                <Button
                  leadingIcon={<Copy size={16} />}
                  onClick={() => {
                    void handleCopyDetails();
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {copyConfirmed
                    ? t("diagnostics.actions.copied")
                    : t("diagnostics.actions.copy_details")}
                </Button>
              ) : null}
            </div>

            {loading ? (
              <div className="diagnostics-loading">{t("diagnostics.loading_description")}</div>
            ) : null}

            {response ? (
              <section className="diagnostics-results" aria-label={t("diagnostics.title")}>
                <div className="diagnostics-issues">
                  {response.checks.map((check) => {
                    const copy = buildCheckCopy(t, check);

                    return (
                      <div className="diagnostics-issue" key={check.id}>
                        <div className="diagnostics-issue__header">
                          <Tag
                            caps={false}
                            color={
                              check.status === "ready"
                                ? "green"
                                : check.status === "checking"
                                  ? "blue"
                                  : "amber"
                            }
                            size="sm"
                          >
                            {t(`diagnostics.status.${check.status}`)}
                          </Tag>
                          <div className="diagnostics-issue__title">{copy.title}</div>
                        </div>
                        <p className="diagnostics-issue__description">{copy.description}</p>
                        <div className="diagnostics-issue__meta">
                          {check.workspacePath ? (
                            <span>
                              {t("diagnostics.details.workspace")}: {check.workspacePath}
                            </span>
                          ) : null}
                          {check.providerId ? (
                            <span>
                              {t("diagnostics.details.provider")}:{" "}
                              {getProviderLabel(check.providerId)}
                            </span>
                          ) : null}
                          {check.missingCommands?.length ? (
                            <span>
                              {t("diagnostics.details.missing_commands")}:{" "}
                              {formatList(check.missingCommands)}
                            </span>
                          ) : null}
                          {check.missingPrerequisites?.length ? (
                            <span>
                              {t("diagnostics.details.missing_prerequisites")}:{" "}
                              {formatList(check.missingPrerequisites)}
                            </span>
                          ) : null}
                        </div>
                        {check.manualGuideKeys?.length ? (
                          <div className="diagnostics-issue__guides">
                            {check.manualGuideKeys.map((guideKey) => (
                              <span key={guideKey}>{t(guideKey)}</span>
                            ))}
                          </div>
                        ) : null}
                        <div className="diagnostics-issue__actions">
                          {check.docUrl ? (
                            <Button
                              as="a"
                              href={check.docUrl}
                              rel="noreferrer"
                              size="sm"
                              target="_blank"
                              variant="ghost"
                            >
                              {t("provider.install.open_docs")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

export default DiagnosticsPage;
