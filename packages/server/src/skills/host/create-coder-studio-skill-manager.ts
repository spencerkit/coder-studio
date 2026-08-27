import { rm } from "node:fs/promises";
import { Topics } from "@coder-studio/core";
import {
  type SkillLibraryRepositoryPort,
  SkillManager,
  type SkillMountRepositoryPort,
} from "@coder-studio/skill-manager";
import { isPathInsideRoot } from "../../fs/path-safety.js";
import type { CommandContext } from "../../ws/dispatch.js";
import { readManagedSkillMarker } from "../managed-skill-metadata.js";
import { buildAgentSkillTargets } from "../target-registry.js";

const EMPTY_LIBRARY: SkillLibraryRepositoryPort = {
  list: () => [],
  get: () => undefined,
  set: (entry) => entry,
  delete: () => undefined,
};

const EMPTY_MOUNTS: SkillMountRepositoryPort = {
  list: () => [],
  get: () => undefined,
  listByProviderId: () => [],
  listBySkillSlug: () => [],
  upsert: (relation) => relation,
  delete: () => undefined,
  deleteBySkillSlug: () => undefined,
  countsByProviderId: () => ({}),
};

export function createCoderStudioSkillManager(ctx: CommandContext): SkillManager {
  return new SkillManager({
    library: ctx.skillLibraryRepo ?? EMPTY_LIBRARY,
    mounts: ctx.skillMountRepo ?? EMPTY_MOUNTS,
    catalog: ctx.skillsHubClient,
    installJobs: ctx.skillInstallMgr,
    mountHost: ctx.skillMountMgr,
    healthHost: ctx.skillHealthMgr,
    targetProvider: ctx.skillHealthMgr
      ? {
          listTargets: async (mountCountsByProviderId) => {
            const targetHealthByProviderId = await ctx.skillHealthMgr!.listTargetHealth();
            return buildAgentSkillTargets({
              providers: ctx.providerRegistry,
              resolvedSkillDirByProviderId: Object.fromEntries(
                ctx.providerRegistry.map((provider) => [
                  provider.id,
                  provider.skillMountDirectories?.[0],
                ])
              ),
              mountCountsByProviderId,
              targetHealthByProviderId,
            });
          },
        }
      : undefined,
    contentHost: ctx.skillLibraryRepo
      ? {
          canRemove: (entry) => entry.source === "custom",
          remove: async (entry) => {
            if (entry.source !== "custom") {
              return;
            }

            const customRoot = ctx.skillLibraryRepo!.getCustomSkillRoot();
            if (!canDeleteCustomSkillPath(customRoot, entry.libraryPath, entry.slug)) {
              return;
            }

            await rm(entry.libraryPath, { recursive: true, force: true }).catch(() => undefined);
          },
        }
      : undefined,
    events: {
      publish: (event) => {
        if (typeof ctx.broadcaster.broadcast !== "function") {
          return;
        }

        ctx.broadcaster.broadcast(Topics.skillLibraryChanged, {
          ...event,
          changedAt: Date.now(),
        });
      },
    },
    hostLabel: "Coder Studio",
  });
}

function canDeleteCustomSkillPath(customRoot: string, libraryPath: string, slug: string): boolean {
  if (!customRoot || !libraryPath || !isPathInsideRoot(customRoot, libraryPath)) {
    return false;
  }

  const marker = readManagedSkillMarker(libraryPath);
  return marker?.source === "custom" && marker.slug === slug;
}
