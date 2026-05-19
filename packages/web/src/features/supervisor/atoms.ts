/**
 * Supervisor atoms (Phase 3)
 */

import type { Supervisor, SupervisorCycle } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

// Supervisor by session ID
export const supervisorsAtom = atom<Map<string, Supervisor>>(new Map());

// Supervisor cycles by supervisor ID
export const supervisorCyclesAtom = atom<Map<string, SupervisorCycle[]>>(new Map());

// Tracks whether a session has already loaded its supervisor state from supervisor.get
export const supervisorHydratedAtomFamily = atomFamily((_sessionId: string) => atom(false));

// Active supervisor objective dialog
export const supervisorDialogAtom = atom<{
  open: boolean;
  sessionId: string | null;
  mode: "enable" | "edit" | "disable";
  draftObjective: string;
  draftEvaluatorProviderId: "claude" | "codex";
  draftEvaluatorModel: string;
  draftMaxSupervisionCount: string;
  draftScheduledAt: string;
}>({
  open: false,
  sessionId: null,
  mode: "enable",
  draftObjective: "",
  draftEvaluatorProviderId: "claude",
  draftEvaluatorModel: "",
  draftMaxSupervisionCount: "0",
  draftScheduledAt: "",
});

export const supervisorDetailsAtom = atom<{
  open: boolean;
  sessionId: string | null;
}>({
  open: false,
  sessionId: null,
});

// Derived atom for getting supervisor by session
export const supervisorBySessionAtom = atom((get) => (sessionId: string) => {
  const supervisors = get(supervisorsAtom);
  return supervisors.get(sessionId);
});
