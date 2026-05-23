import path from "node:path";

export const IN_MEMORY_STATE_DIR = ":memory:";

export function normalizeStateDir(input: string): string {
  return input === IN_MEMORY_STATE_DIR ? input : input;
}

function hasLegacyStateFileExtension(input: string): boolean {
  return path.extname(path.basename(input)) !== "";
}

export function normalizeLegacyStateDir(input: string): string {
  if (input === IN_MEMORY_STATE_DIR) {
    return input;
  }

  return hasLegacyStateFileExtension(input) ? path.dirname(input) : input;
}
