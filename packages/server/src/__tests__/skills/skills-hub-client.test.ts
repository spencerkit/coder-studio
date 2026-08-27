import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SkillsHubClient } from "../../skills/skills-hub-client.js";

const SNAPSHOT_HASH = "12daafb9c4f77deb3c3303dc2e6f8a3c2a0ff7928fc004af959ba18b8bd38068";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function skillSnapshot(files?: Array<{ path: string; contents: string }>) {
  return {
    hash: SNAPSHOT_HASH,
    files: files ?? [
      {
        path: "SKILL.md",
        contents: [
          "---",
          "name: code-review",
          'description: "Review code changes before merge"',
          "---",
          "",
          "Review the current change.",
        ].join("\n"),
      },
      { path: "agents/openai.yaml", contents: "interface:\n  display_name: Code Review\n" },
    ],
  };
}

describe("SkillsHubClient", () => {
  it("searches skills.sh and preserves the repository coordinate", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.github.com") {
        return jsonResponse({ stargazers_count: 518 });
      }
      return jsonResponse({
        skills: [
          {
            skillId: "code-review",
            name: "code-review",
            installs: 8_674,
            source: "mattpocock/skills",
          },
        ],
      });
    });
    const client = new SkillsHubClient({ fetch: fetchMock as typeof fetch });

    await expect(client.search("code review")).resolves.toEqual([
      {
        slug: "code-review",
        registryRef: "mattpocock/skills@code-review",
        displayName: "code-review",
        installCount: 8_674,
        githubStars: 518,
      },
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.origin).toBe("https://skills.sh");
    expect(requestUrl.pathname).toBe("/api/search");
    expect(requestUrl.searchParams.get("q")).toBe("code review");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.github.com/repos/mattpocock/skills"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps search results usable when GitHub star lookup fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.github.com") {
        return new Response("rate limited", { status: 403 });
      }
      return jsonResponse({
        skills: [
          {
            skillId: "code-review",
            name: "code-review",
            installs: 42,
            source: "mattpocock/skills",
          },
        ],
      });
    });
    const client = new SkillsHubClient({ fetch: fetchMock as typeof fetch });

    await expect(client.search("review")).resolves.toEqual([
      {
        slug: "code-review",
        registryRef: "mattpocock/skills@code-review",
        displayName: "code-review",
        installCount: 42,
      },
    ]);
  });

  it("loads exact skill metadata from the skills.sh snapshot", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(skillSnapshot()));
    const client = new SkillsHubClient({ fetch: fetchMock as typeof fetch });

    await expect(client.info("code-review", "mattpocock/skills@code-review")).resolves.toEqual({
      slug: "code-review",
      registryRef: "mattpocock/skills@code-review",
      displayName: "code-review",
      name: "code-review",
      description: "Review code changes before merge",
      version: SNAPSHOT_HASH,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://skills.sh/api/download/mattpocock/skills/code-review"
    );
  });

  it("stages validated snapshot files in the existing export layout", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(skillSnapshot()));
    const client = new SkillsHubClient({ fetch: fetchMock as typeof fetch });
    const staged = await client.stageInstall("code-review", "mattpocock/skills@code-review");

    try {
      await expect(client.readStagedSkill(staged.exportDir, "code-review")).resolves.toContain(
        "Review the current change."
      );
      await expect(
        readFile(join(staged.exportDir, "code-review", "agents", "openai.yaml"), "utf8")
      ).resolves.toContain("Code Review");
      expect(staged.info).toMatchObject({
        registryRef: "mattpocock/skills@code-review",
        version: SNAPSHOT_HASH,
      });
    } finally {
      await client.cleanupStage(staged.tempHome);
    }
  });

  it("rejects snapshot paths that escape the staged skill directory", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        skillSnapshot([
          { path: "SKILL.md", contents: "---\nname: code-review\n---\n" },
          { path: "../outside.txt", contents: "unsafe" },
        ])
      )
    );
    const client = new SkillsHubClient({ fetch: fetchMock as typeof fetch });

    await expect(
      client.stageInstall("code-review", "mattpocock/skills@code-review")
    ).rejects.toThrow("unsafe path");
  });

  it("includes the HTTP status when skills.sh fails", async () => {
    const fetchMock = vi.fn(async () => new Response("temporarily unavailable", { status: 503 }));
    const client = new SkillsHubClient({ fetch: fetchMock as typeof fetch });

    await expect(client.search("review")).rejects.toThrow(
      "skills.sh request failed with HTTP 503: temporarily unavailable"
    );
  });
});
