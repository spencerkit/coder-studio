import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSkillFileAssetRoutes } from "./skill-file-asset.js";

const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

async function buildApp(
  skillPath: string | null,
  source: "custom" | "installed" = "custom",
  origin: "filesystem" | "skillhub" = "filesystem"
) {
  const app = Fastify({ logger: false });
  registerSkillFileAssetRoutes(app, {
    skillLibraryRepo: {
      get: (slug: string) =>
        slug === "my-review-skill" && skillPath
          ? {
              slug,
              displayName: "My Review Skill",
              version: "local",
              source,
              origin,
              libraryPath: skillPath,
              installState: "installed",
              installedAt: 1,
              updatedAt: 1,
            }
          : undefined,
    } as never,
  });
  await app.ready();
  return app;
}

describe("/api/skill-file", () => {
  let testDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `skill-file-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await rm(testDir, { recursive: true, force: true });
  });

  it("streams a skill image with the correct mime type and size", async () => {
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    app = await buildApp(testDir);

    const res = await app.inject({
      method: "GET",
      url: "/api/skill-file?skillSlug=my-review-skill&path=pixel.png",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(PNG_BYTES.length));
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it("returns 400 when skillSlug or path is missing", async () => {
    app = await buildApp(testDir);

    const res = await app.inject({
      method: "GET",
      url: "/api/skill-file?skillSlug=my-review-skill",
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown skills or non-image files", async () => {
    await writeFile(join(testDir, "note.txt"), "secret");
    app = await buildApp(testDir);

    const unknownRes = await app.inject({
      method: "GET",
      url: "/api/skill-file?skillSlug=ghost&path=pixel.png",
    });
    const nonImageRes = await app.inject({
      method: "GET",
      url: "/api/skill-file?skillSlug=my-review-skill&path=note.txt",
    });

    expect(unknownRes.statusCode).toBe(404);
    expect(unknownRes.json()).toMatchObject({ error: "skill_not_found" });
    expect(nonImageRes.statusCode).toBe(404);
    expect(nonImageRes.json()).toMatchObject({ error: "not_an_image" });
  });

  it("rejects path escape attempts", async () => {
    app = await buildApp(testDir);

    const res = await app.inject({
      method: "GET",
      url: "/api/skill-file?skillSlug=my-review-skill&path=../outside.png",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "path_escape" });
  });

  it("returns 404 for non-local skills", async () => {
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    app = await buildApp(testDir, "installed", "skillhub");

    const res = await app.inject({
      method: "GET",
      url: "/api/skill-file?skillSlug=my-review-skill&path=pixel.png",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "skill_not_found" });
  });
});
