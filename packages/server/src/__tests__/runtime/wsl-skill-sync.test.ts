import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WslAgentSkillExportSnapshot } from "../../runtime/wsl-skill-snapshot.js";
import {
  mirrorWslAgentSkillSnapshot,
  syncWindowsAgentSkillsFromHost,
} from "../../runtime/wsl-skill-sync.js";

describe("wsl skill sync", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("replaces mirrored roots so Windows deletions remove stale WSL skills", async () => {
    const home = await mkdtemp(join(tmpdir(), "wsl-skill-sync-home-"));
    roots.push(home);

    const sharedRoot = join(home, ".agents", "skills");
    await mkdir(join(sharedRoot, "stale-skill"), { recursive: true });
    await writeFile(join(sharedRoot, "stale-skill", "SKILL.md"), "stale\n");

    const snapshot: WslAgentSkillExportSnapshot = {
      roots: [
        {
          homeRelativeRoot: ".agents/skills",
          skills: [
            {
              slug: "reviewer",
              files: [
                {
                  relativePath: "SKILL.md",
                  contentBase64: Buffer.from("# Reviewer\n").toString("base64"),
                },
                {
                  relativePath: "refs/tips.md",
                  contentBase64: Buffer.from("tips\n").toString("base64"),
                },
              ],
            },
          ],
        },
      ],
    };

    await mirrorWslAgentSkillSnapshot({ homePath: home, snapshot });

    await expect(readFile(join(sharedRoot, "reviewer", "SKILL.md"), "utf8")).resolves.toBe(
      "# Reviewer\n"
    );
    await expect(readFile(join(sharedRoot, "reviewer", "refs", "tips.md"), "utf8")).resolves.toBe(
      "tips\n"
    );
    await expect(readFile(join(sharedRoot, "stale-skill", "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("overwrites existing files with the Windows snapshot", async () => {
    const home = await mkdtemp(join(tmpdir(), "wsl-skill-sync-overwrite-"));
    roots.push(home);

    const sharedRoot = join(home, ".agents", "skills");
    await mkdir(join(sharedRoot, "reviewer"), { recursive: true });
    await writeFile(join(sharedRoot, "reviewer", "SKILL.md"), "old\n");

    await mirrorWslAgentSkillSnapshot({
      homePath: home,
      snapshot: {
        roots: [
          {
            homeRelativeRoot: ".agents/skills",
            skills: [
              {
                slug: "reviewer",
                files: [
                  {
                    relativePath: "SKILL.md",
                    contentBase64: Buffer.from("new\n").toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await expect(readFile(join(sharedRoot, "reviewer", "SKILL.md"), "utf8")).resolves.toBe("new\n");
  });

  it("rejects path traversal in roots and files", async () => {
    const home = await mkdtemp(join(tmpdir(), "wsl-skill-sync-paths-"));
    roots.push(home);

    await expect(
      mirrorWslAgentSkillSnapshot({
        homePath: home,
        snapshot: {
          roots: [
            {
              homeRelativeRoot: "../escape",
              skills: [],
            },
          ],
        },
      })
    ).rejects.toThrow(/Invalid WSL agent skill root/i);

    await expect(
      mirrorWslAgentSkillSnapshot({
        homePath: home,
        snapshot: {
          roots: [
            {
              homeRelativeRoot: ".agents/skills",
              skills: [
                {
                  slug: "reviewer",
                  files: [
                    {
                      relativePath: "../escape.txt",
                      contentBase64: Buffer.from("boom\n").toString("base64"),
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    ).rejects.toThrow(/Invalid WSL agent skill file path/i);
  });

  it("requests the host snapshot and mirrors it locally", async () => {
    const home = await mkdtemp(join(tmpdir(), "wsl-skill-sync-host-"));
    roots.push(home);

    const relayHostCommand = vi.fn(
      async () =>
        ({
          kind: "result",
          id: "skill-sync",
          ok: true,
          data: {
            roots: [
              {
                homeRelativeRoot: ".claude/skills",
                skills: [
                  {
                    slug: "reviewer",
                    files: [
                      {
                        relativePath: "SKILL.md",
                        contentBase64: Buffer.from("# Claude Skill\n").toString("base64"),
                      },
                    ],
                  },
                ],
              },
            ],
          } satisfies WslAgentSkillExportSnapshot,
        }) satisfies Result
    );

    await syncWindowsAgentSkillsFromHost({
      homePath: home,
      relayHostCommand,
    });

    expect(relayHostCommand).toHaveBeenCalledWith({
      id: "skill-sync",
      op: "workspace.wsl.exportAgentSkills",
      args: {},
    });
    await expect(
      readFile(join(home, ".claude", "skills", "reviewer", "SKILL.md"), "utf8")
    ).resolves.toBe("# Claude Skill\n");
  });

  it("preserves a symlinked skill root and replaces the resolved directory contents", async () => {
    const home = await mkdtemp(join(tmpdir(), "wsl-skill-sync-symlink-root-"));
    roots.push(home);

    const targetRoot = join(home, ".shared-skills");
    const linkedRoot = join(home, ".agents", "skills");
    await mkdir(join(targetRoot, "stale"), { recursive: true });
    await writeFile(join(targetRoot, "stale", "SKILL.md"), "stale\n");
    await mkdir(join(home, ".agents"), { recursive: true });
    await symlink(targetRoot, linkedRoot);

    await mirrorWslAgentSkillSnapshot({
      homePath: home,
      snapshot: {
        roots: [
          {
            homeRelativeRoot: ".agents/skills",
            skills: [
              {
                slug: "reviewer",
                files: [
                  {
                    relativePath: "SKILL.md",
                    contentBase64: Buffer.from("new\n").toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await expect(readFile(join(targetRoot, "reviewer", "SKILL.md"), "utf8")).resolves.toBe("new\n");
    await expect(readFile(join(targetRoot, "stale", "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(lstat(linkedRoot)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
    await expect(lstat(linkedRoot).then((stats) => stats.isSymbolicLink())).resolves.toBe(true);
  });

  it("does not partially replace earlier roots when a later root snapshot is invalid", async () => {
    const home = await mkdtemp(join(tmpdir(), "wsl-skill-sync-atomic-"));
    roots.push(home);

    const sharedRoot = join(home, ".agents", "skills");
    const claudeRoot = join(home, ".claude", "skills");
    await mkdir(join(sharedRoot, "existing"), { recursive: true });
    await mkdir(join(claudeRoot, "existing"), { recursive: true });
    await writeFile(join(sharedRoot, "existing", "SKILL.md"), "shared-old\n");
    await writeFile(join(claudeRoot, "existing", "SKILL.md"), "claude-old\n");

    await expect(
      mirrorWslAgentSkillSnapshot({
        homePath: home,
        snapshot: {
          roots: [
            {
              homeRelativeRoot: ".agents/skills",
              skills: [
                {
                  slug: "reviewer",
                  files: [
                    {
                      relativePath: "SKILL.md",
                      contentBase64: Buffer.from("shared-new\n").toString("base64"),
                    },
                  ],
                },
              ],
            },
            {
              homeRelativeRoot: ".claude/skills",
              skills: [
                {
                  slug: "reviewer",
                  files: [
                    {
                      relativePath: "../escape.txt",
                      contentBase64: Buffer.from("boom\n").toString("base64"),
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    ).rejects.toThrow(/Invalid WSL agent skill file path/i);

    await expect(readFile(join(sharedRoot, "existing", "SKILL.md"), "utf8")).resolves.toBe(
      "shared-old\n"
    );
    await expect(readFile(join(claudeRoot, "existing", "SKILL.md"), "utf8")).resolves.toBe(
      "claude-old\n"
    );
  });
});
