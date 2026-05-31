import type { SystemDependencyId, SystemDependencyPackageManager } from "@coder-studio/core";

export interface SystemDependencyDefinition {
  dependencyId: SystemDependencyId;
  versionCommand: { file: string; args: string[] };
  docsUrl: string;
  manualGuideKeys: string[];
}

export const SYSTEM_DEPENDENCY_DEFINITIONS: Record<SystemDependencyId, SystemDependencyDefinition> =
  {
    git: {
      dependencyId: "git",
      versionCommand: { file: "git", args: ["--version"] },
      docsUrl: "https://git-scm.com/downloads",
      manualGuideKeys: ["system_deps.install.git.manual"],
    },
    node: {
      dependencyId: "node",
      versionCommand: { file: "node", args: ["--version"] },
      docsUrl: "https://nodejs.org/en/download",
      manualGuideKeys: ["system_deps.install.node.manual"],
    },
  };

export const PACKAGE_MANAGER_ORDER: Partial<
  Record<NodeJS.Platform, SystemDependencyPackageManager[]>
> = {
  darwin: ["brew"],
  linux: ["apt-get", "dnf", "yum", "pacman", "zypper"],
};
