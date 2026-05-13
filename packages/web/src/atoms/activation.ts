import { atom } from "jotai";

export type ActivationStatus = "idle" | "claiming" | "active" | "revoked" | "gated";

const CLIENT_INSTANCE_STORAGE_KEY = "app.clientInstanceId";

function createClientInstanceId(): string {
  if (typeof window === "undefined") {
    return "server-client-instance";
  }

  const existing = window.sessionStorage.getItem(CLIENT_INSTANCE_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const next =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  window.sessionStorage.setItem(CLIENT_INSTANCE_STORAGE_KEY, next);
  return next;
}

export const clientInstanceIdAtom = atom<string>(createClientInstanceId());
export const activationStatusAtom = atom<ActivationStatus>("idle");
export const activationGenerationAtom = atom<number | null>(null);
export const activationReasonAtom = atom<string | null>(null);
