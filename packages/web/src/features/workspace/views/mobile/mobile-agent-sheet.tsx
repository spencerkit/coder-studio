import type { ProviderListItem, Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { LifeBuoy, X } from "lucide-react";
import { useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { sessionsAtom } from "../../../../atoms/sessions";
import { ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  type ProviderId,
  useProviderLauncher,
} from "../../../agent-panes/actions/use-provider-launcher";
import { buildDiagnosticsPath } from "../../../diagnostics/navigation";
import { MobileSelectSheet } from "../../../mobile-select";
import { usePersistWorkspaceLastViewedTarget } from "../../actions/use-persist-workspace-last-viewed-target";

interface MobileAgentSheetProps {
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  defaultMode?: "list" | "create";
  sessions: Session[];
  onClose: () => void;
  onCloseSession: (sessionId: string) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onSessionCreated: (sessionId: string) => void;
}

type AgentSheetMode = "sessions" | "providers";

function formatSessionLabel(session: Session) {
  if (session.title?.trim()) {
    return session.title.trim();
  }

  if (session.providerId) {
    return session.providerId.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  const numericId = session.id.match(/(\d+)/)?.[1];
  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, "0")}`;
  }

  return session.id.replace(/[_-]/g, " ").toUpperCase();
}

function formatSessionStateLabel(state: Session["state"], t: ReturnType<typeof useTranslation>) {
  switch (state) {
    case "starting":
      return t("status.starting");
    case "running":
      return t("status.running");
    case "idle":
      return t("status.idle");
    case "ended":
      return t("status.ended");
    default:
      return state;
  }
}

function formatProviderLabel(provider: Pick<ProviderListItem, "badge" | "displayName" | "id">) {
  return provider.badge || provider.displayName || provider.id;
}

function formatProviderMonogram(provider: Pick<ProviderListItem, "badge" | "displayName" | "id">) {
  const label = formatProviderLabel(provider).trim();
  const monogramSource = label || provider.id;
  return monogramSource.slice(0, 2).toUpperCase();
}

const knownProviderIconClasses = new Set(["claude", "codex", "gemini", "cursor", "opencode"]);
const fallbackProviderTones = ["accent", "info", "success", "warning"] as const;

function getProviderFallbackToneClass(providerId: string) {
  if (knownProviderIconClasses.has(providerId)) {
    return "";
  }

  const toneIndex =
    Array.from(providerId).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    fallbackProviderTones.length;

  return `mobile-agent-provider-icon--tone-${fallbackProviderTones[toneIndex]}`;
}

function renderProviderIcon(provider: ProviderListItem) {
  const fallbackToneClass = getProviderFallbackToneClass(provider.id);
  return (
    <span
      aria-hidden="true"
      className={`mobile-agent-provider-icon mobile-agent-provider-icon--${provider.id}${fallbackToneClass ? ` ${fallbackToneClass}` : ""}`}
    >
      <span className="mobile-agent-provider-icon__label">{formatProviderMonogram(provider)}</span>
    </span>
  );
}

export function MobileAgentSheet({
  activeSessionId,
  activeWorkspaceId,
  defaultMode = "list",
  sessions,
  onClose,
  onCloseSession,
  onSelectSession,
  onSessionCreated,
}: MobileAgentSheetProps) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const t = useTranslation();
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();
  const [mode, setMode] = useState<AgentSheetMode>(
    defaultMode === "create" ? "providers" : "sessions"
  );

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const canLaunchSession = Boolean(activeWorkspaceId);

  const closeSheet = () => {
    setMode(defaultMode === "create" ? "providers" : "sessions");
    onClose();
  };

  const { providers, states, launch } = useProviderLauncher(
    dispatch,
    activeWorkspaceId ?? "__workspace_placeholder__",
    (session, _providerId) => {
      setSessions((previous) => ({
        ...previous,
        [session.id]: session,
      }));
      onSessionCreated(session.id);
      closeSheet();
    }
  );

  const canAutoInstall = (providerId: ProviderId): boolean => {
    const runtime = states[providerId]?.runtime;
    return Boolean(runtime?.autoInstallSupported && runtime.installReadiness === "ready");
  };

  const sessionSections = [
    {
      kind: "actions" as const,
      id: "agent-actions",
      items: [
        {
          id: "create",
          label: t("action.create_session"),
          icon: <ThemedIcon semantic="agent.action.newSession" size={16} />,
          onAction: () => setMode("providers"),
          disabled: !canLaunchSession,
        },
      ],
    },
    {
      kind: "options" as const,
      id: "sessions",
      items:
        sessions.length > 0
          ? sessions.map((session) => ({
              id: session.id,
              label: formatSessionLabel(session),
              description: t("mobile.agent.switch_to_agent", {
                name: formatSessionLabel(session),
              }),
              meta: `${session.providerId.toUpperCase()} · ${formatSessionStateLabel(session.state, t)}`,
              trailingAction: {
                id: `${session.id}-close`,
                ariaLabel: t("mobile.agent.close_current_session"),
                icon: <X size={16} />,
                tone: "danger" as const,
                onAction: async () => {
                  await onCloseSession(session.id);
                  closeSheet();
                },
              },
            }))
          : [],
    },
  ];

  const providerSections = [
    {
      kind: "options" as const,
      id: "providers",
      items: providers.flatMap((provider) => {
        const state = states[provider.id];
        if (!state) {
          return [];
        }
        const label = formatProviderLabel(provider);
        const busy =
          state.loading ||
          state.installJob?.status === "queued" ||
          state.installJob?.status === "running";
        const guideMessage = state.runtime?.available
          ? state.inlineError || state.installJob?.failure?.message
          : state.inlineError === "manual" || !canAutoInstall(provider.id)
            ? (state.runtime?.manualGuideKeys ?? []).map((key) => t(key)).join(" ")
            : state.inlineError || state.installJob?.failure?.message;

        return [
          {
            id: provider.id,
            label,
            description: guideMessage || undefined,
            meta: busy ? t("mobile.agent.starting") : t("mobile.agent.start_new_session"),
            icon: renderProviderIcon(provider),
            disabled: !canLaunchSession || busy,
            trailingAction:
              !busy && guideMessage && activeWorkspaceId
                ? {
                    id: `${provider.id}-diagnostics`,
                    ariaLabel: t("diagnostics.actions.open_diagnostics"),
                    icon: <LifeBuoy size={16} />,
                    onAction: () => {
                      window.location.assign(
                        buildDiagnosticsPath({
                          context: "session_start",
                          workspaceId: activeWorkspaceId,
                          providerId: provider.id,
                        })
                      );
                    },
                  }
                : undefined,
          },
        ];
      }),
    },
  ];

  return (
    <MobileSelectSheet
      className="mobile-select-sheet--command mobile-agent-sheet--providers"
      title={mode === "sessions" ? t("mobile.agent.title") : t("session.provider_select")}
      sections={mode === "sessions" ? sessionSections : providerSections}
      selectedId={mode === "sessions" ? (activeSession?.id ?? null) : null}
      emptyText={mode === "sessions" ? t("mobile.agent.empty") : undefined}
      closeOnSelect={false}
      onBack={mode === "providers" ? () => setMode("sessions") : undefined}
      onClose={closeSheet}
      onSelect={(id) => {
        if (mode === "sessions") {
          if (activeWorkspaceId) {
            void persistLastViewedTarget({
              workspaceId: activeWorkspaceId,
              sessionId: id,
            });
          }
          onSelectSession(id);
          closeSheet();
          return;
        }

        return launch(id);
      }}
    />
  );
}

export default MobileAgentSheet;
