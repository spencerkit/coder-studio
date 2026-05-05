import type { Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { Bot, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { sessionsAtom } from "../../../../atoms/sessions";
import { useTranslation } from "../../../../lib/i18n";
import { useProviderLauncher } from "../../../agent-panes/actions/use-provider-launcher";
import { MobileSelectSheet } from "../../../mobile-select";

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
  const [mode, setMode] = useState<AgentSheetMode>(
    defaultMode === "create" ? "providers" : "sessions"
  );

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const canLaunchSession = Boolean(activeWorkspaceId);
  const providerButtons = [
    {
      id: "claude" as const,
      title: "Claude",
      icon: <Sparkles size={16} />,
    },
    {
      id: "codex" as const,
      title: "Codex",
      icon: <Bot size={16} />,
    },
  ];

  const closeSheet = () => {
    setMode(defaultMode === "create" ? "providers" : "sessions");
    onClose();
  };

  const { states, launch } = useProviderLauncher(
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

  const sessionSections = [
    {
      kind: "actions" as const,
      id: "agent-actions",
      items: [
        {
          id: "create",
          label: t("action.create_session"),
          icon: <Plus size={16} />,
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
              meta: session.providerId.toUpperCase(),
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
      items: providerButtons.map((provider) => {
        const state = states[provider.id];
        const busy =
          state.loading ||
          state.installJob?.status === "queued" ||
          state.installJob?.status === "running";

        return {
          id: provider.id,
          label: provider.title,
          description: t("mobile.agent.start_session", { provider: provider.title }),
          meta: busy ? t("mobile.agent.starting") : t("mobile.agent.start_new_session"),
          icon: provider.icon,
          disabled: !canLaunchSession || busy,
        };
      }),
    },
  ];

  return (
    <MobileSelectSheet
      title={mode === "sessions" ? t("mobile.agent.title") : t("session.provider_select")}
      sections={mode === "sessions" ? sessionSections : providerSections}
      selectedId={mode === "sessions" ? (activeSession?.id ?? null) : null}
      emptyText={mode === "sessions" ? t("mobile.agent.empty") : undefined}
      closeOnSelect={false}
      onBack={mode === "providers" ? () => setMode("sessions") : undefined}
      onClose={closeSheet}
      onSelect={(id) => {
        if (mode === "sessions") {
          onSelectSession(id);
          closeSheet();
          return;
        }

        return launch(id as "claude" | "codex");
      }}
    />
  );
}

export default MobileAgentSheet;
