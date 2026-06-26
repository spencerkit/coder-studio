import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveSkillImageAsset } from "../commands/skills/files.js";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";

interface SkillFileAssetQuery {
  skillSlug?: string;
  path?: string;
}

export function registerSkillFileAssetRoutes(
  app: FastifyInstance,
  deps: { skillLibraryRepo: SkillLibraryRepo }
): void {
  app.get(
    "/api/skill-file",
    async (request: FastifyRequest<{ Querystring: SkillFileAssetQuery }>, reply: FastifyReply) => {
      const { skillSlug, path } = request.query;

      if (!skillSlug || !path) {
        return reply.status(400).send({ ok: false, error: "skillSlug and path are required" });
      }

      const entry = deps.skillLibraryRepo.get(skillSlug);
      if (!entry || entry.source !== "custom") {
        return reply.status(404).send({ ok: false, error: "skill_not_found" });
      }

      try {
        const asset = await resolveSkillImageAsset(entry.libraryPath, path);
        reply
          .header("Content-Type", asset.mime)
          .header("Content-Length", String(asset.size))
          .header("Cache-Control", "no-store")
          .header("X-Content-Type-Options", "nosniff");

        return reply.send(createReadStream(asset.absPath));
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: string }).code
            : undefined;

        if (code === "path_escape") {
          return reply.status(400).send({ ok: false, error: "path_escape" });
        }

        if (code === "not_an_image") {
          return reply.status(404).send({ ok: false, error: "not_an_image" });
        }

        return reply.status(404).send({ ok: false, error: "not_found" });
      }
    }
  );
}
