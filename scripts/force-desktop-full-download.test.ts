import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { forceDesktopFullDownload } from "./force-desktop-full-download.js";

const roots: string[] = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-full-download-"));
  roots.push(root);
  const installer = "Coder-Studio-Setup-0.1.2.exe";
  await writeFile(join(root, "latest.yml"), `version: 0.1.2\npath: ${installer}\n`);
  await writeFile(
    join(root, `${installer}.blockmap`),
    gzipSync(
      JSON.stringify({
        version: "2",
        files: [{ name: "file", offsets: [0], checksums: ["checksum"], sizes: [123] }],
      })
    )
  );
  return { root, installer };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("force-desktop-full-download", () => {
  it("marks the target blockmap as incompatible so legacy clients fall back to the full installer", async () => {
    const fixture = await createFixture();

    await expect(forceDesktopFullDownload(fixture.root)).resolves.toMatchObject({
      originalVersion: "2",
      forcedVersion: "2-coder-studio-full-download-0.1.2",
      changed: true,
    });
    const blockmap = JSON.parse(
      gunzipSync(await readFile(join(fixture.root, `${fixture.installer}.blockmap`))).toString(
        "utf8"
      )
    );
    expect(blockmap).toEqual({
      version: "2-coder-studio-full-download-0.1.2",
      files: [{ name: "file", offsets: [0], checksums: ["checksum"], sizes: [123] }],
    });

    await expect(forceDesktopFullDownload(fixture.root)).resolves.toMatchObject({
      forcedVersion: "2-coder-studio-full-download-0.1.2",
      changed: false,
    });
  });

  it("rejects updater paths that escape the release directory", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "latest.yml"), "version: 0.1.2\npath: ../outside.exe\n");

    await expect(forceDesktopFullDownload(fixture.root)).rejects.toThrow("inside");
  });
});
