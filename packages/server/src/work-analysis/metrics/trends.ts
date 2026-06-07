export interface WorkAnalysisDailyTrendBucket {
  day: string;
  totalTokens: number;
  sessionCount: number;
}

export function buildDailyTrendBuckets(
  entries: Iterable<readonly [string, { sessionCount: number; totals: { totalTokens: number } }]>
): WorkAnalysisDailyTrendBucket[] {
  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, value]) => ({
      day,
      totalTokens: value.totals.totalTokens,
      sessionCount: value.sessionCount,
    }));
}
