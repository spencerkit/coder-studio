import { describe, expect, it } from "vitest";

import { buildEfficiencyMetrics } from "../work-analysis/metrics/efficiency.js";

describe("buildEfficiencyMetrics", () => {
  it("computes efficiency scorecards from user turns and all cache usage fields", () => {
    const metrics = buildEfficiencyMetrics([
      makeSessionWithEvents({
        events: [
          event("message_turn", { role: "user" }),
          event("message_turn", { role: "assistant" }),
          event("command"),
          event("edit"),
          event("git_signal"),
          event("usage", {
            inputTokens: 75,
            totalTokens: 1_000,
            cachedInputTokens: 25,
          }),
        ],
      }),
      makeSessionWithEvents({
        events: [
          event("message_turn", { role: "user" }),
          event("message_turn", { role: "assistant" }),
          event("message_turn", { role: "user" }),
          event("message_turn", { role: "assistant" }),
          event("command"),
          event("edit"),
          event("usage", {
            inputTokens: 50,
            totalTokens: 1_000,
            cacheCreationInputTokens: 20,
            cacheReadInputTokens: 30,
          }),
        ],
      }),
      makeSessionWithEvents({
        events: [
          event("message_turn", { role: "user" }),
          event("message_turn", { role: "assistant" }),
          event("command"),
          event("usage", { inputTokens: 200, totalTokens: 1_000 }),
        ],
      }),
    ]);

    expect(metrics).toEqual({
      oneShotRate: 0.333,
      retryRate: 0.333,
      selfCorrectionRate: 0.333,
      readToEditRatio: 2,
      commandToEditRatio: 1.5,
      cacheHitShare: 0.188,
      gitAwareSessionRate: 1,
    });
  });
});

function makeSessionWithEvents(input: { id?: string; events: Array<ReturnType<typeof event>> }) {
  return {
    id: input.id ?? `session-${sessionCounter++}`,
    events: input.events,
  };
}

function event(
  canonicalEventType: "message_turn" | "command" | "edit" | "git_signal" | "usage",
  options: {
    role?: "user" | "assistant";
    inputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  } = {}
) {
  return {
    canonicalEventType,
    role: options.role,
    inputTokens: options.inputTokens ?? 0,
    totalTokens: options.totalTokens ?? 0,
    cachedInputTokens: options.cachedInputTokens ?? 0,
    cacheCreationInputTokens: options.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: options.cacheReadInputTokens ?? 0,
  };
}

let sessionCounter = 1;
