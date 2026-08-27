import { SkillMountRepository } from "@coder-studio/skill-manager";
import { CoderStudioSkillJsonStorage } from "../../skills/host/coder-studio-json-storage.js";

export class SkillMountRepo extends SkillMountRepository {
  constructor(input: { filePath: string }) {
    super(new CoderStudioSkillJsonStorage({ "skills.mounts": input.filePath }));
  }
}
