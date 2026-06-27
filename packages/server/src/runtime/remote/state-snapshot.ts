import type { CustomProviderConfig, Workspace } from "@coder-studio/core";
import type { RemoteStateSnapshot, RuntimeWorkspaceSnapshot } from "./protocol.js";

export function cloneSettingsSnapshot(settings: Record<string, unknown>): Record<string, unknown> {
  return { ...settings };
}

export function cloneCustomProviderConfigs(
  customProviderConfigs: CustomProviderConfig[]
): CustomProviderConfig[] {
  return customProviderConfigs.map((config) => ({
    ...config,
    args: [...config.args],
    env: { ...config.env },
    capabilities: config.capabilities.map((capability) => ({ ...capability })),
  }));
}

export function toRuntimeWorkspaceSnapshot(
  workspace: Pick<Workspace, "id" | "path" | "targetRuntime" | "wslDistro" | "uiState">
): RuntimeWorkspaceSnapshot {
  return {
    id: workspace.id,
    path: workspace.path,
    targetRuntime: workspace.targetRuntime,
    wslDistro: workspace.wslDistro,
    uiState: { ...workspace.uiState },
  };
}

export function cloneWorkspaceSnapshots(
  workspaces: Array<Pick<Workspace, "id" | "path" | "targetRuntime" | "wslDistro" | "uiState">>
): RuntimeWorkspaceSnapshot[] {
  return workspaces.map((workspace) => toRuntimeWorkspaceSnapshot(workspace));
}

export function buildRemoteStateSnapshot(input: {
  settings: Record<string, unknown>;
  workspaces: Array<Pick<Workspace, "id" | "path" | "targetRuntime" | "wslDistro" | "uiState">>;
  customProviders: CustomProviderConfig[];
}): RemoteStateSnapshot {
  return {
    settings: cloneSettingsSnapshot(input.settings),
    workspaces: cloneWorkspaceSnapshots(input.workspaces),
    customProviders: cloneCustomProviderConfigs(input.customProviders),
  };
}
