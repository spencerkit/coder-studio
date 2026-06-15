import { describe, expect, it } from "vitest";
import {
  estimateCommandLineLength,
  prepareHeadlessSpawnCommand,
  shouldDeliverPromptViaStdin,
  WINDOWS_COMMAND_LINE_LIMIT,
} from "./headless-prompt-delivery.js";

describe("headless prompt delivery", () => {
  it("estimates Windows command line length with quoting overhead", () => {
    expect(estimateCommandLineLength(["claude", "-p", "hello world"])).toBeGreaterThan(
      "claude -p hello world".length
    );
  });

  it("requires stdin delivery on Windows when argv exceeds the command line limit", () => {
    const longPrompt = "x".repeat(WINDOWS_COMMAND_LINE_LIMIT);
    const argv = ["claude", "-p", longPrompt, "--output-format", "json"];

    expect(shouldDeliverPromptViaStdin(argv, "win32")).toBe(true);
  });

  it("keeps argv delivery when the command line is short", () => {
    const prompt = "Return strict JSON";
    const command = {
      argv: ["claude", "-p", prompt, "--output-format", "json"],
      cwd: "/workspace",
      env: { CODER_STUDIO_SESSION_ID: "sess-1" },
    };

    expect(prepareHeadlessSpawnCommand(command, prompt, "win32")).toEqual(command);
  });

  it("moves an oversized prompt from argv to stdin while preserving claude -p", () => {
    const prompt = "x".repeat(WINDOWS_COMMAND_LINE_LIMIT);
    const command = {
      argv: ["claude", "-p", prompt, "--output-format", "json"],
    };

    expect(prepareHeadlessSpawnCommand(command, prompt, "win32")).toEqual({
      argv: ["claude", "-p", "--output-format", "json"],
      stdin: prompt,
    });
  });

  it("removes a dangling gemini --prompt flag after moving the prompt to stdin", () => {
    const prompt = "x".repeat(WINDOWS_COMMAND_LINE_LIMIT);
    const command = {
      argv: ["gemini", "--prompt", prompt, "--output-format", "json"],
    };

    expect(prepareHeadlessSpawnCommand(command, prompt, "win32")).toEqual({
      argv: ["gemini", "--output-format", "json"],
      stdin: prompt,
    });
  });

  it("moves codex exec prompts from the trailing positional arg to stdin", () => {
    const prompt = "x".repeat(WINDOWS_COMMAND_LINE_LIMIT);
    const command = {
      argv: ["codex", "exec", "--json", "-s", "read-only", prompt],
    };

    expect(prepareHeadlessSpawnCommand(command, prompt, "win32")).toEqual({
      argv: ["codex", "exec", "--json", "-s", "read-only"],
      stdin: prompt,
    });
  });
});
