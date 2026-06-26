export interface BuiltinSkillManagedFile {
  relativePath: string;
  content: string;
}

export interface BuiltinSkillDefinition {
  slug: string;
  displayName: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  autoMountInMvp: boolean;
  content: string;
  files?: readonly BuiltinSkillManagedFile[];
  mountRendering?: "none" | "automation_bridge";
}
