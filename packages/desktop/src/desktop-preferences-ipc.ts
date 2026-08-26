import type { DesktopPreferencesPatch, DesktopPreferencesSnapshot } from "@coder-studio/core";

interface DesktopPreferencesStorePort {
  getSnapshot(): DesktopPreferencesSnapshot;
  initializeTheme(themeId: string): Promise<DesktopPreferencesSnapshot>;
  update(patch: DesktopPreferencesPatch): Promise<DesktopPreferencesSnapshot>;
}

interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

export interface RegisterDesktopPreferencesIpcOptions {
  ipc: IpcRegistrar;
  getStore: () => DesktopPreferencesStorePort | null;
}

function readThemeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\0\r\n]/.test(value)
  ) {
    throw new Error("Invalid Desktop theme id");
  }
  return value;
}

function readPatch(value: unknown): DesktopPreferencesPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Desktop preferences patch");
  }
  const appearance = (value as { appearance?: unknown }).appearance;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
    throw new Error("Desktop preferences patch has no supported values");
  }
  return {
    appearance: {
      themeId: readThemeId((appearance as { themeId?: unknown }).themeId),
    },
  };
}

function requireStore(
  getStore: RegisterDesktopPreferencesIpcOptions["getStore"]
): DesktopPreferencesStorePort {
  const store = getStore();
  if (!store) throw new Error("Desktop preferences are not initialized");
  return store;
}

export function registerDesktopPreferencesIpc(options: RegisterDesktopPreferencesIpcOptions): void {
  options.ipc.handle("desktop:get-preferences", () => requireStore(options.getStore).getSnapshot());
  options.ipc.handle("desktop:initialize-theme-preference", (_event, themeId) =>
    requireStore(options.getStore).initializeTheme(readThemeId(themeId))
  );
  options.ipc.handle("desktop:update-preferences", (_event, patch) =>
    requireStore(options.getStore).update(readPatch(patch))
  );
}
