import type { SkillJsonDocumentName, SkillJsonStorage } from "@coder-studio/skill-manager";
import { readJsonFile, writeJsonFileAtomic } from "../../storage/repositories/json-file-store.js";

export class CoderStudioSkillJsonStorage implements SkillJsonStorage {
  constructor(private readonly filePaths: Partial<Record<SkillJsonDocumentName, string>>) {}

  read(name: SkillJsonDocumentName): unknown | undefined {
    const filePath = this.filePaths[name];
    return filePath ? readJsonFile<unknown>(filePath) : undefined;
  }

  write(name: SkillJsonDocumentName, value: unknown): void {
    const filePath = this.filePaths[name];
    if (!filePath) {
      throw new Error(`No JSON storage path configured for ${name}`);
    }
    writeJsonFileAtomic(filePath, value);
  }
}
