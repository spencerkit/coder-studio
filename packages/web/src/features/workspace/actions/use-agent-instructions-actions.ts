import type {
  AgentInstructionsDocument,
  AgentInstructionsPanelStatus,
  AgentInstructionsSystemDocument,
  AgentInstructionsSystemStatusEntry,
  ProviderListItem,
  ProviderRuntimeStatusResponse,
} from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CommandResult, dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { workspaceByIdAtomFamily } from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import { workspaceTopic } from "../../../ws/subscription";
import { useOpenLocation } from "../../code-editor/actions/use-open-location";
import { toSystemAgentInstructionsEditorPath } from "../../code-editor/system-agent-instructions-path";
import type { OpenTextFile } from "../atoms";
import { openFilesAtomFamily } from "../atoms";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

const CUSTOM_INSTRUCTIONS_SCAFFOLD = `# Agent Instructions

## Project Notes
- Summarize the areas of this workspace agents should understand first.

## Working Preferences
- Add any testing, review, or delivery expectations for this project.
`;

function buildSystemInstructionsScaffold(displayName: string): string {
  return `# Agent Instructions

## ${displayName} Defaults
- Add global preferences this agent tool should follow across projects.
`;
}

function createUnsavedTextDraft(path: string, content: string, displayPath?: string): OpenTextFile {
  return {
    kind: "text",
    path,
    displayPath,
    content,
    savedContent: "",
    baseHash: "",
    isDirty: true,
  };
}

type BusyAction = "attach" | "edit" | "generate" | "refresh_status" | "toggle_expanded" | null;
type AgentInstructionsGenerateAndWriteResult = {
  document: AgentInstructionsDocument;
  meta: {
    providerId: string;
    model?: string;
  };
};
type GenerationDialogMode = "generate" | "regenerate";
type GenerationDialogOption = {
  value: string;
  label: string;
};
type GenerationDialogState = {
  open: boolean;
  mode: GenerationDialogMode;
  providerId: string;
  model: string;
  options: GenerationDialogOption[];
};
type ProviderListItemWithGeneration = ProviderListItem & {
  supportsAgentInstructionsGeneration?: boolean;
};
type ProviderRuntimeStatusEntryWithGeneration =
  ProviderRuntimeStatusResponse["providers"][string] & {
    supportsAgentInstructionsGeneration?: boolean;
  };

const AGENT_INSTRUCTIONS_GENERATION_TIMEOUT_MS = 120_000;

function getErrorMessage<T>(result: CommandResult<T>, fallback: string): string {
  return result.error?.message || fallback;
}

function getGenerateErrorMessage<T>(
  result: CommandResult<T>,
  t: (key: string) => string,
  fallback: string
): string {
  const code = result.error?.code;
  if (code === "agent_instructions_generation_timeout") {
    return t("workspace.agent_instructions.generate_timeout");
  }
  if (code === "agent_instructions_generation_no_output") {
    return t("workspace.agent_instructions.generate_no_output");
  }
  if (
    code === "command_error" &&
    result.error?.message === "Command timeout: agentInstructions.generateAndWriteByAgent"
  ) {
    return t("workspace.agent_instructions.generate_timeout");
  }

  return getErrorMessage(result, fallback);
}

function isAgentInstructionsPanelStatus(value: unknown): value is AgentInstructionsPanelStatus {
  if (!value || typeof value !== "object") {
    return false;
  }

  const status = value as AgentInstructionsPanelStatus;
  return (
    typeof status.document?.exists === "boolean" && typeof status.document?.stale === "boolean"
  );
}

export function useAgentInstructionsActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const workspace = useAtomValue(workspaceByIdAtomFamily(workspaceId));
  const setOpenFiles = useSetAtom(openFilesAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const dispatchRef = useRef(dispatch);
  const tRef = useRef(t);
  const [status, setStatus] = useState<AgentInstructionsPanelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [generationDialog, setGenerationDialog] = useState<GenerationDialogState | null>(null);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const runAction = useCallback(
    async <T>(action: Exclude<BusyAction, null>, fn: () => Promise<T>) => {
      setBusyAction(action);
      setError(null);

      try {
        return await fn();
      } catch (actionError) {
        const message =
          actionError instanceof Error
            ? actionError.message
            : t("workspace.agent_instructions.failed");
        setError(message);
        return null;
      } finally {
        setBusyAction((current) => (current === action ? null : current));
      }
    },
    [t]
  );

  const refreshStatus = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null);
      setLoading(false);
      return null;
    }

    setBusyAction("refresh_status");
    setError(null);

    try {
      const result = await dispatchRef.current<AgentInstructionsPanelStatus>(
        "agentInstructions.status",
        {
          workspaceId,
        }
      );

      if (!result.ok || !isAgentInstructionsPanelStatus(result.data)) {
        throw new Error(
          getErrorMessage(result, tRef.current("workspace.agent_instructions.status_load_failed"))
        );
      }

      setStatus(result.data);
      return result.data;
    } catch (actionError) {
      const message =
        actionError instanceof Error
          ? actionError.message
          : tRef.current("workspace.agent_instructions.failed");
      setError(message);
      return null;
    } finally {
      setBusyAction((current) => (current === "refresh_status" ? null : current));
    }
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    void refreshStatus().finally(() => setLoading(false));
  }, [refreshStatus]);

  useEffect(() => {
    if (!workspaceId || !wsClient || typeof wsClient.subscribe !== "function") {
      return;
    }

    return wsClient.subscribe([workspaceTopic(workspaceId, "fs.dirty")], () => {
      void refreshStatus();
    });
  }, [refreshStatus, workspaceId, wsClient]);

  const openPath = useCallback(
    async (path: string) => {
      await openLocation({
        workspaceId,
        path,
        source: "manual",
      });
    },
    [openLocation, workspaceId]
  );

  const generateDraft = useCallback(
    async () =>
      runAction("generate", async () => {
        const result = await dispatch<AgentInstructionsGenerateAndWriteResult>(
          "agentInstructions.generateAndWriteByAgent",
          {
            workspaceId,
          },
          { timeoutMs: AGENT_INSTRUCTIONS_GENERATION_TIMEOUT_MS }
        );

        if (!result.ok || !result.data) {
          throw new Error(
            getGenerateErrorMessage(result, t, t("workspace.agent_instructions.generate_failed"))
          );
        }

        await refreshStatus();
        return result.data.document;
      }),
    [dispatch, refreshStatus, runAction, t, workspaceId]
  );

  const closeGenerateDialog = useCallback(() => {
    setGenerationDialog(null);
  }, []);

  const openGenerateDialog = useCallback(
    async (mode: GenerationDialogMode) =>
      runAction("generate", async () => {
        const [providerListResult, runtimeStatusResult] = await Promise.all([
          dispatch<ProviderListItem[]>("provider.list", {}),
          dispatch<ProviderRuntimeStatusResponse>("provider.runtimeStatus", { workspaceId }),
        ]);

        if (!providerListResult.ok || !providerListResult.data) {
          throw new Error(t("workspace.agent_instructions.providers_load_failed"));
        }

        if (!runtimeStatusResult.ok || !runtimeStatusResult.data) {
          throw new Error(t("workspace.agent_instructions.providers_load_failed"));
        }

        const options = providerListResult.data
          .filter((provider) => {
            const runtimeEntry = runtimeStatusResult.data?.providers[provider.id] as
              | ProviderRuntimeStatusEntryWithGeneration
              | undefined;
            const supportsGeneration =
              (provider as ProviderListItemWithGeneration).supportsAgentInstructionsGeneration ??
              runtimeEntry?.supportsAgentInstructionsGeneration ??
              false;

            return supportsGeneration && runtimeEntry?.available;
          })
          .map((provider) => ({
            value: provider.id,
            label: provider.displayName,
          }));

        if (options.length === 0) {
          throw new Error(t("workspace.agent_instructions.no_generation_provider"));
        }

        setGenerationDialog({
          open: true,
          mode,
          providerId: options[0]!.value,
          model: "",
          options,
        });

        return options;
      }),
    [dispatch, runAction, t]
  );

  const setGenerateDialogProviderId = useCallback((providerId: string) => {
    setGenerationDialog((current) =>
      current
        ? {
            ...current,
            providerId,
          }
        : current
    );
  }, []);

  const setGenerateDialogModel = useCallback((model: string) => {
    setGenerationDialog((current) =>
      current
        ? {
            ...current,
            model,
          }
        : current
    );
  }, []);

  const submitGenerateDialog = useCallback(() => {
    if (!generationDialog) {
      return;
    }

    const request = {
      providerId: generationDialog.providerId,
      model: generationDialog.model.trim(),
    };
    setGenerationDialog(null);

    void runAction("generate", async () => {
      const result = await dispatch<AgentInstructionsGenerateAndWriteResult>(
        "agentInstructions.generateAndWriteByAgent",
        {
          workspaceId,
          providerId: request.providerId,
          ...(request.model ? { model: request.model } : {}),
        },
        { timeoutMs: AGENT_INSTRUCTIONS_GENERATION_TIMEOUT_MS }
      );

      if (!result.ok || !result.data) {
        throw new Error(
          getGenerateErrorMessage(result, t, t("workspace.agent_instructions.generate_failed"))
        );
      }

      await refreshStatus();
      return result.data.document;
    });
  }, [dispatch, generationDialog, refreshStatus, runAction, t, workspaceId]);

  const viewCustom = useCallback(async () => {
    if (!status?.document.exists) {
      return null;
    }

    await openPath(status.document.path);
    return status.document.path;
  }, [openPath, status]);

  const editCustom = useCallback(
    async () =>
      runAction("edit", async () => {
        const path = status?.document.path ?? ".coder-studio/agent.md";
        if (!status?.document.exists) {
          setOpenFiles((prev) =>
            prev[path]
              ? prev
              : {
                  ...prev,
                  [path]: createUnsavedTextDraft(path, CUSTOM_INSTRUCTIONS_SCAFFOLD),
                }
          );
        }

        await openPath(path);
        return path;
      }),
    [openPath, runAction, setOpenFiles, status]
  );

  const editSystem = useCallback(
    async (entry: AgentInstructionsSystemStatusEntry) =>
      runAction("edit", async () => {
        if (!entry.editable) {
          return null;
        }

        const path = toSystemAgentInstructionsEditorPath(entry.providerId);
        if (!entry.exists) {
          setOpenFiles((prev) =>
            prev[path]
              ? prev
              : {
                  ...prev,
                  [path]: createUnsavedTextDraft(
                    path,
                    buildSystemInstructionsScaffold(entry.displayName),
                    entry.displayPath
                  ),
                }
          );
        }

        await openPath(path);
        return path;
      }),
    [openPath, runAction, setOpenFiles]
  );

  const attachToCurrentSession = useCallback(
    async () =>
      runAction("attach", async () => {
        const result = await dispatch("agentInstructions.attachToSession", {
          workspaceId,
        });

        if (!result.ok) {
          throw new Error(getErrorMessage(result, t("workspace.agent_instructions.attach_failed")));
        }

        return result.data ?? null;
      }),
    [dispatch, runAction, t, workspaceId]
  );

  const setExpanded = useCallback(
    async (expanded: boolean) =>
      runAction("toggle_expanded", async () => {
        const ok = await persistUiState({
          agentInstructionsExpanded: expanded,
        });

        if (!ok) {
          throw new Error(t("workspace.agent_instructions.expand_failed"));
        }

        return expanded;
      }),
    [persistUiState, runAction, t]
  );

  const canResolveEffective = useMemo(() => Boolean(status?.document.exists), [status]);

  return {
    attachToCurrentSession,
    busyAction,
    canResolveEffective,
    closeGenerateDialog,
    editCustom,
    editSystem,
    error,
    generationDialog,
    generateDraft,
    loading,
    openGenerateDialog,
    setExpanded,
    setGenerateDialogModel,
    setGenerateDialogProviderId,
    status,
    submitGenerateDialog,
    viewCustom,
    workspace,
  };
}
