export interface WslAgentSkillFileSnapshot {
  relativePath: string;
  contentBase64: string;
}

export interface WslAgentSkillDirectorySnapshot {
  slug: string;
  files: WslAgentSkillFileSnapshot[];
}

export interface WslAgentSkillRootSnapshot {
  homeRelativeRoot: string;
  skills: WslAgentSkillDirectorySnapshot[];
}

export interface WslAgentSkillExportSnapshot {
  roots: WslAgentSkillRootSnapshot[];
}
