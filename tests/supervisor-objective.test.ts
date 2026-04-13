import test from "node:test";
import assert from "node:assert/strict";

import {
  composeSupervisorObjectivePreview,
  normalizeSupervisorObjective,
} from "../apps/web/src/features/workspace/supervisor-objective.ts";

test("normalizeSupervisorObjective trims surrounding whitespace", () => {
  assert.equal(normalizeSupervisorObjective("  Keep using xterm only.  "), "Keep using xterm only.");
});

test("composeSupervisorObjectivePreview matches server prompt composition", () => {
  assert.equal(
    composeSupervisorObjectivePreview("  Keep using xterm only.  "),
    [
      "You are the supervisor for a business agent terminal session.",
      "Your job is to read the active goal, the latest turn context, and produce the next message that should be sent to the business agent.",
      "Stay aligned with the user's intent. Do not redesign the product scope.",
      "",
      "Active objective:",
      "Keep using xterm only.",
      "",
    ].join("\n"),
  );
});

test("composeSupervisorObjectivePreview returns empty string for blank objective", () => {
  assert.equal(composeSupervisorObjectivePreview("   \n  "), "");
});
