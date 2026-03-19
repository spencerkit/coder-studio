import type { SessionMode } from "../../state/workbench";
import type { BackendArchiveEntry, BackendSession, SessionPatch } from "../../types/app";
import { invokeRpc } from "./client";

export const createSession = (tabId: string, mode: SessionMode) =>
  invokeRpc<BackendSession>("create_session", { tabId, mode });

export const updateSession = (tabId: string, sessionId: number, patch: SessionPatch) =>
  invokeRpc<void>("session_update", { tabId, sessionId, patch });

export const switchSession = (tabId: string, sessionId: number) =>
  invokeRpc<void>("switch_session", { tabId, sessionId });

export const archiveSession = (tabId: string, sessionId: number) =>
  invokeRpc<BackendArchiveEntry>("archive_session", { tabId, sessionId });

export const updateIdlePolicy = (tabId: string, policy: {
  enabled: boolean;
  idleMinutes: number;
  maxActive: number;
  pressure: boolean;
}) => invokeRpc<void>("update_idle_policy", { tabId, policy });
