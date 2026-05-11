import {
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  DEFAULT_SUPERVISOR_RETRY_DELAY_SEC,
  DEFAULT_SUPERVISOR_RETRY_ENABLED,
  DEFAULT_SUPERVISOR_RETRY_MAX_COUNT,
  DEFAULT_SUPERVISOR_RETRY_ON_EVALUATOR_ERROR,
  DEFAULT_SUPERVISOR_RETRY_ON_TIMEOUT,
  resolveSupervisorEvaluationTimeoutSec,
  resolveSupervisorRetryDelaySec,
  resolveSupervisorRetryEnabled,
  resolveSupervisorRetryMaxCount,
  resolveSupervisorRetryOnEvaluatorError,
  resolveSupervisorRetryOnTimeout,
} from "@coder-studio/core";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";

export const SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY = "supervisor.evaluationTimeoutSec";
export const SUPERVISOR_RETRY_ENABLED_SETTING_KEY = "supervisor.retryEnabled";
export const SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY = "supervisor.retryMaxCount";
export const SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY = "supervisor.retryDelaySec";
export const SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY = "supervisor.retryOnTimeout";
export const SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY = "supervisor.retryOnEvaluatorError";

export interface SupervisorRetrySettings {
  retryEnabled: boolean;
  retryMaxCount: number;
  retryDelaySec: number;
  retryOnTimeout: boolean;
  retryOnEvaluatorError: boolean;
}

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

function getSettingOrDefault<T>(
  settingsRepo: Pick<SettingsRepo, "get"> | undefined,
  key: string,
  fallback: T
): T {
  try {
    return (settingsRepo?.get<T>(key) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function getSupervisorRetrySettings(
  settingsRepo?: Pick<SettingsRepo, "get">
): SupervisorRetrySettings {
  return {
    retryEnabled: resolveSupervisorRetryEnabled(
      getSettingOrDefault(
        settingsRepo,
        SUPERVISOR_RETRY_ENABLED_SETTING_KEY,
        DEFAULT_SUPERVISOR_RETRY_ENABLED
      )
    ),
    retryMaxCount: resolveSupervisorRetryMaxCount(
      getSettingOrDefault(
        settingsRepo,
        SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY,
        DEFAULT_SUPERVISOR_RETRY_MAX_COUNT
      )
    ),
    retryDelaySec: resolveSupervisorRetryDelaySec(
      getSettingOrDefault(
        settingsRepo,
        SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY,
        DEFAULT_SUPERVISOR_RETRY_DELAY_SEC
      )
    ),
    retryOnTimeout: resolveSupervisorRetryOnTimeout(
      getSettingOrDefault(
        settingsRepo,
        SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY,
        DEFAULT_SUPERVISOR_RETRY_ON_TIMEOUT
      )
    ),
    retryOnEvaluatorError: resolveSupervisorRetryOnEvaluatorError(
      getSettingOrDefault(
        settingsRepo,
        SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY,
        DEFAULT_SUPERVISOR_RETRY_ON_EVALUATOR_ERROR
      )
    ),
  };
}
