export interface MonacoWorkspaceModelRegistry {
  disposeWorkspace(workspaceRootPath: string): void;
}

let globalMonacoModelRegistry: MonacoWorkspaceModelRegistry | null = null;

export function setGlobalMonacoModelRegistry(registry: MonacoWorkspaceModelRegistry | null): void {
  globalMonacoModelRegistry = registry;
}

export function getGlobalMonacoModelRegistry(): MonacoWorkspaceModelRegistry | null {
  return globalMonacoModelRegistry;
}

export function resetGlobalMonacoModelRegistry(): void {
  globalMonacoModelRegistry = null;
}
