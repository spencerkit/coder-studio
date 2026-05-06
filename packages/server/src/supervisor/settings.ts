import {
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  resolveSupervisorEvaluationTimeoutSec,
} from "@coder-studio/core";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";

export const SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY = "supervisor.evaluationTimeoutSec";

export function getSupervisorEvaluationTimeoutMs(settingsRepo?: Pick<SettingsRepo, "get">): number {
  let storedValue: number | undefined;
  try {
    storedValue = settingsRepo?.get<number>(SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY);
  } catch {
    storedValue = DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC;
  }

  const timeoutSec = resolveSupervisorEvaluationTimeoutSec(storedValue);
  return timeoutSec * 1000;
}
