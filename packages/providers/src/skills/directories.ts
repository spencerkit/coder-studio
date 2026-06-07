import { homedir } from "node:os";
import { join } from "node:path";

const sharedSkillsDir = join(homedir(), ".agents", "skills");

export function providerSkillMountDirectories(providerHomeDirName: string): string[] {
  return [join(homedir(), providerHomeDirName, "skills")];
}

export function sharedFirstSkillMountDirectories(providerHomeDirName: string): string[] {
  return [sharedSkillsDir, ...providerSkillMountDirectories(providerHomeDirName)];
}

export function opencodeSkillMountDirectories(): string[] {
  return [
    sharedSkillsDir,
    join(homedir(), ".config", "opencode", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
}
