import type { SystemDependencyInstallInteraction } from "@coder-studio/core";

const SUDO_PASSWORD_PATTERNS = [/\[sudo\] password for .*:$/i, /^password:$/i];
const CONFIRM_PATTERNS = [/proceed\?\s*\[[^\]]+\]$/i, /continue\?\s*\[[^\]]+\]$/i];

export function detectSystemDependencyInteraction(
  chunk: string
): SystemDependencyInstallInteraction {
  const trimmed = chunk.trim();

  if (SUDO_PASSWORD_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      kind: "sudo_password",
      promptExcerpt: trimmed,
      echo: false,
    };
  }

  if (CONFIRM_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      kind: "confirm",
      promptExcerpt: trimmed,
      echo: true,
    };
  }

  return {
    kind: "none",
    echo: false,
  };
}
