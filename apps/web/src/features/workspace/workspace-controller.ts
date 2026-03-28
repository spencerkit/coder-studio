import type { WorkspaceControllerLease } from "../../types/app.ts";

const DEVICE_ID_STORAGE_KEY = "coder-studio.workspace-device-id";
const CLIENT_ID_STORAGE_KEY = "coder-studio.workspace-client-id";

export type WorkspaceControllerRole = "controller" | "observer";

export type WorkspaceMutationAction =
  | "switch_session"
  | "switch_pane"
  | "switch_terminal"
  | "resize_terminal"
  | "shell_input"
  | "agent_input"
  | "close_session"
  | "close_terminal"
  | "close_workspace"
  | "create_terminal";

export type WorkspaceControllerState = {
  role: WorkspaceControllerRole;
  deviceId: string;
  clientId: string;
  controllerDeviceId?: string;
  controllerClientId?: string;
  fencingToken: number;
  takeoverPending: boolean;
  takeoverRequestedBySelf: boolean;
  takeoverRequestId?: string;
  takeoverDeadlineAt?: number;
  leaseExpiresAt?: number;
};

export type WorkspaceControllerMutationPayload = {
  deviceId: string;
  clientId: string;
  fencingToken: number;
};

type WorkspaceControllerReleaseTab = {
  id: string;
  status?: string;
  controller?: WorkspaceControllerState | null;
};

const createRuntimeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const readStorage = (storage: Storage | undefined, key: string) => {
  if (!storage) return "";
  try {
    return storage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
};

const writeStorage = (storage: Storage | undefined, key: string, value: string) => {
  if (!value || !storage) return value;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage failures; in-memory identity still works for the current page.
  }
  return value;
};

const getOrCreateStorageId = (storage: Storage | undefined, key: string, prefix: string) => {
  const existing = readStorage(storage, key);
  if (existing) return existing;
  return writeStorage(storage, key, createRuntimeId(prefix));
};

const localStorageRef = () => (typeof window === "undefined" ? undefined : window.localStorage);
const sessionStorageRef = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

export const getOrCreateDeviceId = () =>
  getOrCreateStorageId(localStorageRef(), DEVICE_ID_STORAGE_KEY, "device");

export const getOrCreateClientId = () =>
  getOrCreateStorageId(sessionStorageRef(), CLIENT_ID_STORAGE_KEY, "client");

export const createWorkspaceControllerState = (
  input: Partial<WorkspaceControllerState> = {},
): WorkspaceControllerState => ({
  role: input.role === "observer" ? "observer" : "controller",
  deviceId: input.deviceId ?? "",
  clientId: input.clientId ?? "",
  controllerDeviceId: input.controllerDeviceId,
  controllerClientId: input.controllerClientId,
  fencingToken: Number.isFinite(input.fencingToken) ? Number(input.fencingToken) : 0,
  takeoverPending: Boolean(input.takeoverPending),
  takeoverRequestedBySelf: Boolean(input.takeoverRequestedBySelf),
  takeoverRequestId: input.takeoverRequestId,
  takeoverDeadlineAt: Number.isFinite(input.takeoverDeadlineAt) ? Number(input.takeoverDeadlineAt) : undefined,
  leaseExpiresAt: Number.isFinite(input.leaseExpiresAt) ? Number(input.leaseExpiresAt) : undefined,
});

export const createWorkspaceControllerStateFromLease = (
  lease: WorkspaceControllerLease,
  deviceId: string,
  clientId: string,
): WorkspaceControllerState => {
  const controllerDeviceId = lease.controller_device_id ?? undefined;
  const controllerClientId = lease.controller_client_id ?? undefined;
  const takeoverRequestedByDeviceId = lease.takeover_requested_by_device_id ?? undefined;
  const takeoverRequestedByClientId = lease.takeover_requested_by_client_id ?? undefined;

  return createWorkspaceControllerState({
    role:
      controllerDeviceId === deviceId && controllerClientId === clientId
        ? "controller"
        : "observer",
    deviceId,
    clientId,
    controllerDeviceId,
    controllerClientId,
    fencingToken: lease.fencing_token ?? 0,
    takeoverPending: Boolean(lease.takeover_request_id),
    takeoverRequestedBySelf:
      takeoverRequestedByDeviceId === deviceId
      && takeoverRequestedByClientId === clientId,
    takeoverRequestId: lease.takeover_request_id ?? undefined,
    takeoverDeadlineAt: lease.takeover_deadline_at ?? undefined,
    leaseExpiresAt: lease.lease_expires_at ?? undefined,
  });
};

export const createWorkspaceControllerMutationPayload = (
  controller: WorkspaceControllerState | null | undefined,
): WorkspaceControllerMutationPayload => ({
  deviceId: controller?.deviceId ?? "",
  clientId: controller?.clientId ?? "",
  fencingToken: Number.isFinite(controller?.fencingToken)
    ? Number(controller?.fencingToken)
    : 0,
});

export const createWorkspaceControllerRpcPayload = (
  workspaceId: string,
  controller: WorkspaceControllerState | null | undefined,
  payload: Record<string, unknown> = {},
) => ({
  workspaceId,
  ...createWorkspaceControllerMutationPayload(controller),
  ...payload,
});

export const collectControlledWorkspaceReleasePayloads = (
  tabs: WorkspaceControllerReleaseTab[],
) => tabs
  .filter((tab) => tab.status === "ready" && tab.controller?.role === "controller")
  .map((tab) => ({
    workspaceId: tab.id,
    ...createWorkspaceControllerMutationPayload(tab.controller),
  }));

export const canMutateWorkspace = (
  controller: WorkspaceControllerState | null | undefined,
  _action: WorkspaceMutationAction,
) => controller?.role === "controller";

export const shouldRecoverWorkspaceController = (
  controller: WorkspaceControllerState | null | undefined,
) => controller?.role === "observer" && !controller.takeoverPending;
