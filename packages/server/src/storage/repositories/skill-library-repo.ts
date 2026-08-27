import { relative } from "node:path";
import { SkillLibraryRepository } from "@coder-studio/skill-manager";
import { CoderStudioSkillJsonStorage } from "../../skills/host/coder-studio-json-storage.js";
import { scanDiscoveredSkillEntries } from "../../skills/local-skill-scanner.js";

interface SkillLibraryRepoInput {
  filePath: string;
  builtinRoot?: string;
  managedLibraryRoot?: string;
  customSkillRoot?: string;
  externalSkillRoots?: string[];
  localSkillRoots?: string[];
}

export class SkillLibraryRepo extends SkillLibraryRepository {
  constructor(private readonly input: SkillLibraryRepoInput) {
    super({
      storage: new CoderStudioSkillJsonStorage({ "skills.library": input.filePath }),
      discover: () =>
        scanDiscoveredSkillEntries({
          builtinRoot: input.builtinRoot,
          managedLibraryRoot: input.managedLibraryRoot,
          customRoot: input.customSkillRoot,
          externalRoots: input.externalSkillRoots ?? input.localSkillRoots ?? [],
        }),
      isCustomLocation: (libraryPath) => isPathInsideRoot(libraryPath, input.customSkillRoot ?? ""),
    });
  }

  getCustomSkillRoot(): string {
    return this.input.customSkillRoot ?? "";
  }

  getLocalRoots(): string[] {
    if (this.input.customSkillRoot) {
      return [this.input.customSkillRoot, ...(this.input.externalSkillRoots ?? [])];
    }

    return [...(this.input.localSkillRoots ?? [])];
  }
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  if (!rootPath) {
    return false;
  }

  const relativePath = relative(rootPath, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":/");
}
