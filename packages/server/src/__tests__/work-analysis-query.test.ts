import { describe, expect, it } from "vitest";

import {
  buildWorkAnalysisQueryDigest,
  normalizeWorkAnalysisQuery,
  resolveWorkAnalysisTimeRange,
} from "../work-analysis/query.js";

describe("work analysis query helpers", () => {
  it("sorts and de-duplicates workspace paths during normalization", () => {
    expect(
      normalizeWorkAnalysisQuery({
        workspacePaths: ["/repo/b", "/repo/a", "/repo/a"],
        timeRange: { preset: "7d" },
      })
    ).toEqual({
      workspacePaths: ["/repo/a", "/repo/b"],
      timeRange: { preset: "7d" },
    });
  });

  it("resolves preset ranges relative to now", () => {
    expect(resolveWorkAnalysisTimeRange({ preset: "24h" }, 10_000)).toEqual({
      startAt: 10_000 - 24 * 60 * 60 * 1000,
      endAt: 10_000,
      label: "24h",
    });
  });

  it("passes through custom ranges unchanged", () => {
    expect(
      resolveWorkAnalysisTimeRange(
        {
          startAt: 1_000,
          endAt: 2_000,
        },
        10_000
      )
    ).toEqual({
      startAt: 1_000,
      endAt: 2_000,
      label: "1000-2000",
    });
  });

  it("builds a stable digest for equivalent queries", () => {
    const left = buildWorkAnalysisQueryDigest({
      workspacePaths: ["/repo/b", "/repo/a", "/repo/a"],
      timeRange: { preset: "30d" },
    });
    const right = buildWorkAnalysisQueryDigest({
      workspacePaths: ["/repo/a", "/repo/b"],
      timeRange: { preset: "30d" },
    });

    expect(left).toBe(right);
  });
});
