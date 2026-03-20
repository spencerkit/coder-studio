import type { SessionMode } from "../../state/workbench";
import type { BackendArchiveEntry, BackendSession, SessionPatch } from "../../types/app";
import { invokeRpc } from "./client";

export const createSession = (workspaceId: string, mode: SessionMode) =>
  invokeRpc<BackendSession>("create_session", { workspaceId, mode });

export const updateSession = (workspaceId: string, sessionId: number, patch: SessionPatch) =>
  invokeRpc<BackendSession>("session_update", { workspaceId, sessionId, patch });

export const switchSession = (workspaceId: string, sessionId: number) =>
  invokeRpc<BackendSession>("switch_session", { workspaceId, sessionId });

export const archiveSession = (workspaceId: string, sessionId: number) =>
  invokeRpc<BackendArchiveEntry>("archive_session", { workspaceId, sessionId });

export const updateIdlePolicy = (workspaceId: string, policy: {
  enabled: boolean;
  idleMinutes: number;
  maxActive: number;
  pressure: boolean;
}) => invokeRpc<void>("update_idle_policy", { workspaceId, policy });
