import { describe, expect, it } from "vitest";
import {
  hashAgentInstructionsContent,
  normalizeAgentInstructionsContent,
} from "../../agent-instructions/effective.js";

describe("agent instruction helpers", () => {
  it("normalizes trailing whitespace consistently", () => {
    expect(normalizeAgentInstructionsContent("# Agent Instructions\n\n")).toBe(
      "# Agent Instructions\n"
    );
  });

  it("hashes normalized content consistently", () => {
    expect(hashAgentInstructionsContent("# Agent Instructions")).toBe(
      hashAgentInstructionsContent("# Agent Instructions\n")
    );
  });
});
