import { describe, expect, it } from "vitest";

import { summarizeOneShot } from "../work-analysis/metrics/one-shot.js";
import { countTurnRetries } from "../work-analysis/metrics/retry.js";

describe("work analysis retry metrics", () => {
  it("counts a same-file edit shell edit sequence as one retry", () => {
    expect(
      countTurnRetries([
        { tool: "Edit", file: "src/foo.ts" },
        { tool: "Bash", command: "pnpm test" },
        { tool: "Edit", file: "src/foo.ts" },
      ])
    ).toBe(1);
  });

  it("does not treat editing different files across shell steps as a retry", () => {
    expect(
      countTurnRetries([
        { tool: "Edit", file: "src/foo.ts" },
        { tool: "Bash", command: "pnpm test" },
        { tool: "Edit", file: "src/bar.ts" },
      ])
    ).toBe(0);
  });

  it("counts multiple same-file retry cycles within a turn", () => {
    expect(
      countTurnRetries([
        { tool: "Edit", file: "src/foo.ts" },
        { tool: "Bash", command: "pnpm test foo" },
        { tool: "Edit", file: "src/foo.ts" },
        { tool: "Bash", command: "pnpm test foo" },
        { tool: "Edit", file: "src/foo.ts" },
      ])
    ).toBe(2);
  });

  it("summarizes one-shot and retries per edit turn", () => {
    const summary = summarizeOneShot([
      { hasEdits: true, retries: 0 },
      { hasEdits: true, retries: 2 },
      { hasEdits: false, retries: 0 },
    ]);

    expect(summary).toEqual({
      editTurnCount: 2,
      oneShotTurnCount: 1,
      retryTurnCount: 1,
      oneShotRate: 0.5,
      retryRate: 1,
    });
  });

  it("returns zero rates when there are no edit turns", () => {
    expect(summarizeOneShot([{ hasEdits: false, retries: 3 }])).toEqual({
      editTurnCount: 0,
      oneShotTurnCount: 0,
      retryTurnCount: 0,
      oneShotRate: 0,
      retryRate: 0,
    });
  });
});
