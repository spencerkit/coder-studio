import { SkillTargetRepository } from "@coder-studio/skill-manager";
import { CoderStudioSkillJsonStorage } from "../../skills/host/coder-studio-json-storage.js";

export type { SkillTargetSettingRecord } from "@coder-studio/skill-manager";

export class SkillTargetRepo extends SkillTargetRepository {
  constructor(input: { filePath: string }) {
    super(new CoderStudioSkillJsonStorage({ "skills.targets": input.filePath }));
  }
}
