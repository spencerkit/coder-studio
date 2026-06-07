import { describe, expect, it, vi } from "vitest";
import { SkillsHubClient } from "../../skills/skills-hub-client.js";

describe("SkillsHubClient", () => {
  it("runs search with the expected CLI arguments", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "1. code-review\n   Name: Code Review\n",
      stderr: "",
    }));
    const client = new SkillsHubClient({ runCommand });

    const results = await client.search("review");

    expect(runCommand).toHaveBeenCalledWith(
      "npx",
      ["-y", "@skills-hub-ai/cli", "search", "review", "--limit", "20"],
      undefined
    );
    expect(results[0]).toMatchObject({ slug: "code-review", displayName: "Code Review" });
  });

  it("stages install through a temp HOME and then syncs to an export dir", async () => {
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const client = new SkillsHubClient({ runCommand });

    const staged = await client.stageInstall("code-review");

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "npx",
      ["-y", "@skills-hub-ai/cli", "install", "code-review", "--target", "codex", "--no-save"],
      expect.objectContaining({
        env: expect.objectContaining({ HOME: staged.tempHome }),
      })
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "npx",
      ["-y", "@skills-hub-ai/cli", "sync", "codex", "--output", staged.exportDir],
      expect.objectContaining({
        env: expect.objectContaining({ HOME: staged.tempHome }),
      })
    );
  });
});
