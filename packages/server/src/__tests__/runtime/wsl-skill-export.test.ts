import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectHomeRelativeSkillRoots,
  exportAgentSkillSnapshot,
} from "../../runtime/wsl-skill-export.js";

function provider(id: string, roots: string[]): ProviderDefinition {
  return {
    id,
    displayName: id,
    badge: id,
    kind: "built_in",
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: [id], env: {}, cwd: "/" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: [id],
    supportsSkillsMount: true,
    skillMountDirectories: roots,
  } satisfies ProviderDefinition;
}

describe("wsl skill export", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("dedupes home-relative roots while preserving shared and provider-specific directories", () => {
    const home = "/Users/tester";
    const roots = collectHomeRelativeSkillRoots(
      [
        provider("codex", ["/Users/tester/.agents/skills", "/Users/tester/.codex/skills"]),
        provider("gemini", ["/Users/tester/.agents/skills", "/Users/tester/.gemini/skills"]),
        provider("claude", ["/Users/tester/.claude/skills"]),
      ],
      home
    );

    expect(roots).toEqual([".agents/skills", ".codex/skills", ".gemini/skills", ".claude/skills"]);
  });

  it("exports each skill directory as base64 file payloads rooted under the user home", async () => {
    root = await mkdtemp(join(tmpdir(), "wsl-skill-export-"));
    const home = join(root, "home");
    const sharedRoot = join(home, ".agents", "skills");
    await mkdir(join(sharedRoot, "code-review", "refs"), { recursive: true });
    await writeFile(join(sharedRoot, "code-review", "SKILL.md"), "# Code Review\n");
    await writeFile(join(sharedRoot, "code-review", "refs", "guide.md"), "guide\n");
    await writeFile(join(sharedRoot, "README.txt"), "ignore me\n");

    const snapshot = await exportAgentSkillSnapshot({
      homePath: home,
      providerRegistry: [provider("codex", [sharedRoot])],
    });

    expect(snapshot.roots).toEqual([
      {
        homeRelativeRoot: ".agents/skills",
        skills: [
          {
            slug: "code-review",
            files: [
              {
                relativePath: "SKILL.md",
                contentBase64: Buffer.from("# Code Review\n").toString("base64"),
              },
              {
                relativePath: "refs/guide.md",
                contentBase64: Buffer.from("guide\n").toString("base64"),
              },
            ],
          },
        ],
      },
    ]);
  });

  it("returns empty roots so WSL can delete stale skills when Windows removed them", async () => {
    root = await mkdtemp(join(tmpdir(), "wsl-skill-export-empty-"));
    const home = join(root, "home");
    await mkdir(join(home, ".claude", "skills"), { recursive: true });

    const snapshot = await exportAgentSkillSnapshot({
      homePath: home,
      providerRegistry: [provider("claude", [join(home, ".claude", "skills")])],
    });

    expect(snapshot.roots).toEqual([
      {
        homeRelativeRoot: ".claude/skills",
        skills: [],
      },
    ]);
  });

  it("skips already-visited symlinked directories instead of recursing forever", async () => {
    root = await mkdtemp(join(tmpdir(), "wsl-skill-export-cycle-"));
    const home = join(root, "home");
    const sharedRoot = join(home, ".agents", "skills");
    const skillRoot = join(sharedRoot, "code-review");
    await mkdir(join(skillRoot, "refs"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# Code Review\n");
    await writeFile(join(skillRoot, "refs", "guide.md"), "guide\n");
    await symlink(".", join(skillRoot, "loop"));

    const snapshot = await exportAgentSkillSnapshot({
      homePath: home,
      providerRegistry: [provider("codex", [sharedRoot])],
    });

    expect(snapshot.roots).toEqual([
      {
        homeRelativeRoot: ".agents/skills",
        skills: [
          {
            slug: "code-review",
            files: [
              {
                relativePath: "SKILL.md",
                contentBase64: Buffer.from("# Code Review\n").toString("base64"),
              },
              {
                relativePath: "refs/guide.md",
                contentBase64: Buffer.from("guide\n").toString("base64"),
              },
            ],
          },
        ],
      },
    ]);
  });
});
