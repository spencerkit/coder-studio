import { describe, expect, it } from "vitest";
import {
  extractAgentInstructionsMarkdownFromCodexJsonl,
  extractAgentInstructionsReplyText,
  normalizeGeneratedAgentInstructionsMarkdown,
  parseGeneratedAgentInstructionsPayload,
} from "../../agent-instructions/output.js";

describe("agent instructions output extraction", () => {
  it("extracts the final completed agent_message text from Codex JSONL output", () => {
    const jsonl = [
      JSON.stringify({
        type: "item.completed",
        item: { id: "1", type: "agent_message", text: "" },
      }),
      JSON.stringify({ type: "item.started", item: { id: "2", type: "reasoning" } }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "3",
          type: "agent_message",
          text: '```json\n{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview"}\n```',
        },
      }),
    ].join("\n");

    expect(extractAgentInstructionsReplyText("codex", jsonl)).toBe(
      '```json\n{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview"}\n```'
    );
  });

  it.each([
    "claude",
    "gemini",
    "cursor",
  ] as const)("extracts the final reply text from %s JSON envelopes", (providerId) => {
    const envelope = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: '{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview"}',
    });

    expect(extractAgentInstructionsReplyText(providerId, envelope)).toBe(
      '{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview"}'
    );
  });

  it("parses a successful generation payload and normalizes markdown", () => {
    const replyText =
      '```json\n{"ok":true,"content":"```markdown\\n# Agent Instructions\\n\\n## Project Overview\\n```"}\n```';

    expect(parseGeneratedAgentInstructionsPayload(replyText)).toBe(
      "# Agent Instructions\n\n## Project Overview\n"
    );
  });

  it("strips a wrapping markdown fence and normalizes a trailing newline", () => {
    const wrapped = "```markdown\n# Agent Instructions\n\n## Project Overview\n```\n";

    expect(normalizeGeneratedAgentInstructionsMarkdown(wrapped)).toBe(
      "# Agent Instructions\n\n## Project Overview\n"
    );
  });

  it("throws a typed parse error when no agent instructions heading is present", () => {
    expect.assertions(2);

    try {
      normalizeGeneratedAgentInstructionsMarkdown("## Project Overview\n");
    } catch (error) {
      expect(error).toMatchObject({
        code: "agent_instructions_parse_failed",
      });
      expect(error).toHaveProperty("message");
    }
  });

  it("throws a typed parse error for near-miss agent instructions headings", () => {
    for (const content of [
      "# Agent InstructionsX\n\n## Project Overview\n",
      "# Agent Instructions foo\n\n## Project Overview\n",
    ]) {
      expect(() => normalizeGeneratedAgentInstructionsMarkdown(content)).toThrowError(
        /agent instructions/i
      );

      try {
        normalizeGeneratedAgentInstructionsMarkdown(content);
      } catch (error) {
        expect(error).toMatchObject({
          code: "agent_instructions_parse_failed",
        });
      }
    }
  });

  it("throws a typed parse error when the generation payload reports failure", () => {
    expect.assertions(2);

    try {
      parseGeneratedAgentInstructionsPayload('{"ok":false,"message":"provider refused"}');
    } catch (error) {
      expect(error).toMatchObject({
        code: "agent_instructions_parse_failed",
      });
      expect(error).toMatchObject({
        message: expect.stringContaining("provider refused"),
      });
    }
  });

  it("throws a typed parse error when no usable completed agent_message exists", () => {
    expect.assertions(2);

    try {
      extractAgentInstructionsReplyText(
        "codex",
        [
          JSON.stringify({ type: "item.completed", item: { id: "1", type: "reasoning" } }),
          JSON.stringify({
            type: "item.completed",
            item: { id: "2", type: "agent_message", text: "" },
          }),
        ].join("\n")
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: "agent_instructions_parse_failed",
      });
      expect(error).toHaveProperty("message");
    }
  });

  it("throws a typed parse error for malformed Codex JSONL input", () => {
    expect.assertions(2);

    try {
      extractAgentInstructionsReplyText("codex", "{not-json");
    } catch (error) {
      expect(error).toMatchObject({
        code: "agent_instructions_parse_failed",
      });
      expect(error).toHaveProperty("message");
    }
  });

  it("throws a typed parse error for malformed generation payload JSON", () => {
    expect.assertions(2);

    try {
      parseGeneratedAgentInstructionsPayload("{not-json");
    } catch (error) {
      expect(error).toMatchObject({
        code: "agent_instructions_parse_failed",
      });
      expect(error).toHaveProperty("message");
    }
  });

  it("keeps the legacy Codex helper working with JSON payload output", () => {
    const jsonl = [
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "3",
          type: "agent_message",
          text: '{"ok":true,"content":"# Agent Instructions\\n\\n## Project Overview"}',
        },
      }),
    ].join("\n");

    expect(extractAgentInstructionsMarkdownFromCodexJsonl(jsonl)).toBe(
      "# Agent Instructions\n\n## Project Overview\n"
    );
  });
});
