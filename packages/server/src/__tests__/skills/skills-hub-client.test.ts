import { describe, expect, it, vi } from "vitest";
import { SkillsHubClient } from "../../skills/skills-hub-client.js";

describe("SkillsHubClient", () => {
  it("runs search with the expected CLI arguments", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify([
        {
          slug: "code-review",
          name: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
        },
      ]),
      stderr: "",
    }));
    const client = new SkillsHubClient({ runCommand });

    const results = await client.search("review");

    expect(runCommand).toHaveBeenCalledWith(
      "npx",
      ["-y", "@skill-hub/cli", "search", "review", "--limit", "20", "--json"],
      expect.objectContaining({
        env: expect.objectContaining({ NO_COLOR: expect.any(String) }),
      })
    );
    expect(results[0]).toMatchObject({ slug: "code-review", displayName: "Code Review" });
  });

  it("derives skill info from exact JSON search results", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify([
        {
          slug: "other-review",
          name: "Other Review",
          description: "Another result",
        },
        {
          slug: "code-review",
          name: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
        },
      ]),
      stderr: "",
    }));
    const client = new SkillsHubClient({ runCommand });

    const info = await client.info("code-review");

    expect(runCommand).toHaveBeenCalledWith(
      "npx",
      ["-y", "@skill-hub/cli", "search", "code-review", "--limit", "50", "--json"],
      expect.objectContaining({
        env: expect.objectContaining({ NO_COLOR: expect.any(String) }),
      })
    );
    expect(info).toEqual({
      slug: "code-review",
      name: "Code Review",
      description: "Review code changes before merge",
      version: "1.2.3",
    });
  });

  it("stages install directly into an export dir", async () => {
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const client = new SkillsHubClient({ runCommand });

    const staged = await client.stageInstall("code-review");

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "npx",
      [
        "-y",
        "@skill-hub/cli",
        "install",
        "code-review",
        "--agent",
        "codex",
        "--yes",
        "--dir",
        staged.exportDir,
      ],
      expect.objectContaining({
        env: expect.objectContaining({ HOME: staged.tempHome }),
      })
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("includes CLI stderr when a Skills Hub command fails", async () => {
    const runCommand = vi.fn(async () => {
      throw Object.assign(new Error("Command failed with exit code 1"), {
        stderr: "npm error 404 Not Found - GET https://registry.npmjs.org/missing-package",
        stdout: "",
      });
    });
    const client = new SkillsHubClient({ runCommand });

    await expect(client.search("review")).rejects.toThrow("npm error 404 Not Found");
  });
});
