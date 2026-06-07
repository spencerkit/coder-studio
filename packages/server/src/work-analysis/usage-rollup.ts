import type { WorkLogUsage, WorkLogUsageCall, WorkLogUsageCoverage } from "./log-sources/types.js";

const usageFieldNames = [
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningOutputTokens",
  "totalTokens",
  "estimatedCostUsd",
] as const;

type UsageFieldName = (typeof usageFieldNames)[number];

export function normalizeUsageValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

export function hasUsageData(usage: WorkLogUsage | undefined): boolean {
  if (!usage) {
    return false;
  }

  return usageFieldNames.some((fieldName) => normalizeUsageValue(usage[fieldName]) !== undefined);
}

export function deriveUsageTotalTokens(usage: WorkLogUsage | undefined): number | undefined {
  const explicit = normalizeUsageValue(usage?.totalTokens);
  if (explicit !== undefined) {
    return explicit;
  }

  if (!usage) {
    return undefined;
  }

  const inputTokens = normalizeUsageValue(usage.inputTokens) ?? 0;
  const outputTokens = normalizeUsageValue(usage.outputTokens) ?? 0;
  const cacheCreationInputTokens = normalizeUsageValue(usage.cacheCreationInputTokens) ?? 0;
  const cacheReadInputTokens = normalizeUsageValue(usage.cacheReadInputTokens) ?? 0;
  const derived = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;

  return derived > 0 ? derived : undefined;
}

export function normalizeUsage(usage: WorkLogUsage | undefined): WorkLogUsage | undefined {
  if (!hasUsageData(usage)) {
    return undefined;
  }

  const normalized: WorkLogUsage = {};
  for (const fieldName of usageFieldNames) {
    const value = normalizeUsageValue(usage?.[fieldName]);
    if (value !== undefined) {
      normalized[fieldName] = value;
    }
  }

  const totalTokens = deriveUsageTotalTokens(normalized);
  if (totalTokens !== undefined) {
    normalized.totalTokens = totalTokens;
  }

  return normalized;
}

export function sumUsageCalls(calls: WorkLogUsageCall[] | undefined): WorkLogUsage | undefined {
  if (!calls || calls.length === 0) {
    return undefined;
  }

  const totals: WorkLogUsage = {};
  for (const call of calls) {
    for (const fieldName of usageFieldNames) {
      if (fieldName === "totalTokens") {
        continue;
      }
      addUsageField(totals, fieldName, call.usage[fieldName]);
    }
    addUsageField(totals, "totalTokens", deriveUsageTotalTokens(call.usage));
  }

  return normalizeUsage(totals);
}

export function buildUsageCoverage(
  calls: WorkLogUsageCall[] | undefined
): WorkLogUsageCoverage | undefined {
  if (!calls || calls.length === 0) {
    return undefined;
  }

  const callsWithUsage = calls.filter((call) => hasUsageData(call.usage));
  if (callsWithUsage.length === 0) {
    return undefined;
  }

  return {
    hasUsage: true,
    callCount: callsWithUsage.length,
    callsWithTotalTokens: callsWithUsage.filter(
      (call) => deriveUsageTotalTokens(call.usage) !== undefined
    ).length,
    estimatedCallCount: callsWithUsage.filter((call) => call.isEstimated).length,
  };
}

function addUsageField(target: WorkLogUsage, fieldName: UsageFieldName, value: unknown) {
  const normalized = normalizeUsageValue(value);
  if (normalized === undefined) {
    return;
  }

  target[fieldName] = (target[fieldName] ?? 0) + normalized;
}
