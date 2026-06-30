export const DESKTOP_USER_DATA_DIR_ENV_VAR = "CODER_STUDIO_DESKTOP_USER_DATA_DIR";

interface AppPathLike {
  setPath(name: string, value: string): void;
}

export function resolveDesktopUserDataDirOverride(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const value = env[DESKTOP_USER_DATA_DIR_ENV_VAR]?.trim();
  return value ? value : null;
}

export function applyDesktopUserDataDirOverride(input: {
  app: AppPathLike;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const override = resolveDesktopUserDataDirOverride(input.env);
  if (!override) {
    return null;
  }

  input.app.setPath("userData", override);
  return override;
}
