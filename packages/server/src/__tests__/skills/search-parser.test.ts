import { describe, expect, it } from "vitest";
import { parseSkillsHubSearchOutput } from "../../skills/search-parser.js";

describe("parseSkillsHubSearchOutput", () => {
  it("extracts search rows from CLI text output", () => {
    const output = [
      "1. code-review",
      "   Name: Code Review",
      "   Description: Review code changes before merge",
      "2. security-audit",
      "   Name: Security Audit",
      "   Description: Find high-risk vulnerabilities",
    ].join("\n");

    expect(parseSkillsHubSearchOutput(output)).toEqual([
      {
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
      },
      {
        slug: "security-audit",
        displayName: "Security Audit",
        description: "Find high-risk vulnerabilities",
      },
    ]);
  });

  it("extracts rows from the current Skills Hub CLI output", () => {
    const output = [
      "\u001b[1mFound 2 skills:\u001b[22m",
      "",
      "  \u001b[90m[--]\u001b[39m \u001b[1mcode-review\u001b[22m \u001b[90mv1.0.0\u001b[39m",
      "     \u001b[90mThorough code review - checks correctness, security, performance\u001b[39m",
      "     \u001b[36mnpx @skills-hub-ai/cli install code-review\u001b[39m  \u001b[90m40 installs\u001b[39m",
      "",
      "  \u001b[90m[--]\u001b[39m \u001b[1msecurity-review\u001b[22m \u001b[90mv2.0.0\u001b[39m",
      "     \u001b[90mSecurity audit and vulnerability assessment for any codebase.\u001b[39m",
      "     \u001b[36mnpx @skills-hub-ai/cli install security-review\u001b[39m  \u001b[90m14 installs\u001b[39m",
    ].join("\n");

    expect(parseSkillsHubSearchOutput(output)).toEqual([
      {
        slug: "code-review",
        displayName: "code-review",
        description: "Thorough code review - checks correctness, security, performance",
      },
      {
        slug: "security-review",
        displayName: "security-review",
        description: "Security audit and vulnerability assessment for any codebase.",
      },
    ]);
  });
});
