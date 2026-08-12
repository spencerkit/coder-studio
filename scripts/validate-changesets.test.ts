import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAllowedChangesetPackages,
  findChangesetMarkdownFiles,
} from "./validate-changesets.js";

describe("validate-changesets", () => {
  it("returns no files when the changeset directory only has the generated README", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-changesets-"));
    const changesetDir = join(dir, ".changeset");

    await mkdir(changesetDir, { recursive: true });
    await writeFile(join(changesetDir, "README.md"), "# Changesets\n");

    await expect(findChangesetMarkdownFiles(changesetDir)).resolves.toEqual([]);
  });

  it("accepts changesets that target the CLI and Desktop packages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-changesets-"));
    const changesetDir = join(dir, ".changeset");
    const filePath = join(changesetDir, "green-lion.md");

    await mkdir(changesetDir, { recursive: true });
    await writeFile(
      filePath,
      `---
"@spencer-kit/coder-studio": minor
"@coder-studio/desktop": patch
---

Expose a new CLI flag and update the Desktop Shell.
`
    );

    await expect(assertAllowedChangesetPackages([filePath])).resolves.toBeUndefined();
  });

  it("rejects changesets that target packages outside the release surfaces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-changesets-"));
    const changesetDir = join(dir, ".changeset");
    const filePath = join(changesetDir, "red-bird.md");

    await mkdir(changesetDir, { recursive: true });
    await writeFile(
      filePath,
      `---
"@coder-studio/core": patch
"@spencer-kit/coder-studio": patch
---

Internal package changes should be released through the CLI package only.
`
    );

    await expect(assertAllowedChangesetPackages([filePath])).rejects.toThrow("@coder-studio/core");
  });
});
