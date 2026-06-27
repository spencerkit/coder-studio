import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveSkillImageAsset } from "../commands/skills/files.js";
import type { RuntimeRouter } from "../host/runtime-router.js";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { WorkspaceManager } from "../workspace/manager.js";

interface SkillFileAssetQuery {
  workspaceId?: string;
  skillSlug?: string;
  path?: string;
}

interface RuntimeAssetPayload {
  mime: string;
  size: number;
  bytesBase64: string;
}

function sendRuntimeAsset(reply: FastifyReply, asset: RuntimeAssetPayload) {
  const bytes = Buffer.from(asset.bytesBase64, "base64");
  return reply
    .header("Content-Type", asset.mime)
    .header("Content-Length", String(asset.size))
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .send(bytes);
}

export function registerSkillFileAssetRoutes(
  app: FastifyInstance,
  deps: {
    skillLibraryRepo: SkillLibraryRepo;
    workspaceMgr?: Pick<WorkspaceManager, "get">;
    runtimeRouter?: RuntimeRouter;
  }
): void {
  app.get(
    "/api/skill-file",
    async (request: FastifyRequest<{ Querystring: SkillFileAssetQuery }>, reply: FastifyReply) => {
      const { workspaceId, skillSlug, path } = request.query;

      if (!skillSlug || !path) {
        return reply.status(400).send({ ok: false, error: "skillSlug and path are required" });
      }

      if (workspaceId) {
        const workspace = deps.workspaceMgr?.get(workspaceId);
        if (!workspace) {
          return reply.status(404).send({ ok: false, error: "workspace_not_found" });
        }

        if (workspace.targetRuntime === "wsl") {
          try {
            const asset = (await deps.runtimeRouter?.executeOnTarget(
              { kind: "workspace", workspaceId },
              "skills.files.readAsset",
              {
                workspaceId,
                skillSlug,
                path,
              }
            )) as RuntimeAssetPayload | undefined;

            if (!asset) {
              throw { code: "runtime_router_unavailable", message: "Runtime router unavailable" };
            }

            return sendRuntimeAsset(reply, asset);
          } catch (error) {
            const code =
              typeof error === "object" && error !== null && "code" in error
                ? (error as { code?: string }).code
                : undefined;

            if (code === "path_escape") {
              return reply.status(400).send({ ok: false, error: "path_escape" });
            }

            if (code === "runtime_router_unavailable") {
              return reply.status(503).send({ ok: false, error: code });
            }

            return reply.status(404).send({ ok: false, error: code ?? "not_found" });
          }
        }
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
