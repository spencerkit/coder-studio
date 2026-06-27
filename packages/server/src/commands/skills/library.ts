import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import {
  checkSkillHubVersion,
  requireSkillsQuerySupport,
  requireSkillVersionCheckSupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

export function registerSkillLibraryCommands(): void {
  registerRuntimeCommand("skills.library.list", skillRuntimeTargetSchema, {
    resolveTarget: (args) => resolveSkillRuntimeTarget(args),
    handler: async (_args, ctx) => {
      requireSkillsQuerySupport(ctx);

      const skillLibraryRepo = ctx.skillLibraryRepo;
      const skillMountRepo = ctx.skillMountRepo;

      return skillLibraryRepo.list().map((entry) => {
        const mounts = skillMountRepo.listBySkillSlug(entry.slug).filter((item) => item.enabled);
        const errors = mounts.filter((item) => item.status === "failed" || item.status === "stale");

        return {
          ...entry,
          mountedProviderIds: mounts.map((item) => item.providerId),
          mountStatus:
            errors.length > 0
              ? "error"
              : mounts.length === 0
                ? "unmounted"
                : mounts.length === 1
                  ? "partially_mounted"
                  : "fully_mounted",
          errorCount: errors.length,
        };
      });
    },
  });

  registerRuntimeCommand("skills.versions.check", skillRuntimeTargetSchema, {
    resolveTarget: (args) => resolveSkillRuntimeTarget(args),
    handler: async (_args, ctx) => {
      requireSkillVersionCheckSupport(ctx);

      const skillHubEntries = ctx.skillLibraryRepo
        .list()
        .filter(
          (entry) =>
            entry.source === "installed" &&
            entry.origin === "skillhub" &&
            entry.installState === "installed"
        );

      return Promise.all(skillHubEntries.map((entry) => checkSkillHubVersion(entry, ctx)));
    },
  });
}
