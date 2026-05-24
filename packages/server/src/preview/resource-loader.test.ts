import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPreviewResource, resolvePreviewResourcePath } from "./resource-loader.js";

describe("resolvePreviewResourcePath", () => {
  it("resolves nested relative assets from the entry directory", () => {
    expect(resolvePreviewResourcePath("docs/guide/intro.md", "./img/cover.png")).toBe(
      "docs/guide/img/cover.png"
    );
    expect(resolvePreviewResourcePath("examples/demo/index.html", "../shared/theme.css")).toBe(
      "examples/shared/theme.css"
    );
  });

  it("rejects path escape attempts", () => {
    expect(() =>
      resolvePreviewResourcePath("examples/demo/index.html", "../../../../etc/passwd")
    ).toThrowError(/path_escape/);
    expect(() =>
      resolvePreviewResourcePath("examples/demo/index.html", "..\\..\\..\\..\\etc\\passwd")
    ).toThrowError(/path_escape/);
  });
});

describe("loadPreviewResource", () => {
  let rootDir = "";

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = "";
    }
  });

  it("loads bytes, size, and mime metadata for a workspace-relative asset", async () => {
    rootDir = join(
      tmpdir(),
      `preview-resource-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(join(rootDir, "examples", "shared"), { recursive: true });
    await writeFile(join(rootDir, "examples", "shared", "theme.css"), "body { color: red; }");

    const resource = await loadPreviewResource(rootDir, "examples/shared/theme.css");

    expect(resource.workspaceRelativePath).toBe("examples/shared/theme.css");
    expect(resource.mime).toBe("text/css");
    expect(resource.size).toBe(Buffer.byteLength("body { color: red; }"));
    expect(resource.bytes.toString("utf-8")).toBe("body { color: red; }");
  });

  it("rejects symlinked resources that resolve outside the workspace root", async () => {
    rootDir = join(
      tmpdir(),
      `preview-resource-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const outsideDir = join(
      tmpdir(),
      `preview-resource-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    await mkdir(join(rootDir, "examples"), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.css"), "body { color: blue; }");
    await symlink(join(outsideDir, "secret.css"), join(rootDir, "examples", "escape.css"));

    await expect(loadPreviewResource(rootDir, "examples/escape.css")).rejects.toThrowError(
      /path_escape/
    );

    await rm(outsideDir, { recursive: true, force: true });
  });
});
