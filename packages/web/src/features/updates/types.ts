import type {
  DesktopUpdateSettings,
  ProductUpdatePreparation,
  ProductUpdateState,
  UpdateStateView,
} from "@coder-studio/core";

export type UpdateControllerKind = "desktop" | "cli" | "readonly";

export interface UpdateCommandResult<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message: string };
}

export type UpdateCommandDispatcher = <T>(
  operation: string,
  args: Record<string, unknown>,
  options?: undefined
) => Promise<UpdateCommandResult<T>>;

export interface DesktopUpdateBridge {
  updateApiVersion: 1;
  getUpdateState(): Promise<ProductUpdateState>;
  checkForUpdates(): Promise<ProductUpdateState>;
  downloadUpdate(): Promise<ProductUpdateState>;
  retryUpdate(): Promise<ProductUpdateState>;
  cancelUpdateDownload(): Promise<ProductUpdateState>;
  prepareUpdateRestart(): Promise<ProductUpdateState>;
  restartAndInstallUpdate(): Promise<boolean>;
  getUpdateSettings(): Promise<DesktopUpdateSettings>;
  setUpdateSettings(
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ): Promise<DesktopUpdateSettings>;
  onUpdateStateChanged(listener: (state: ProductUpdateState) => void): () => void;
}

export interface UpdateController {
  readonly kind: UpdateControllerKind;
  getState(): ProductUpdateState;
  refresh(): Promise<ProductUpdateState>;
  check(): Promise<ProductUpdateState>;
  download(): Promise<ProductUpdateState>;
  retry(): Promise<ProductUpdateState>;
  cancelDownload(): Promise<ProductUpdateState>;
  prepare(): Promise<ProductUpdatePreparation>;
  start(prepared: ProductUpdatePreparation, force: boolean): Promise<ProductUpdateState>;
  getSettings(): Promise<DesktopUpdateSettings | null>;
  setSettings(
    patch: Partial<Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">>
  ): Promise<DesktopUpdateSettings | null>;
  subscribe(listener: (state: ProductUpdateState) => void): () => void;
  dispose(): void;
}

export interface CreateUpdateControllerInput {
  serverState: UpdateStateView;
  desktopBridge: DesktopUpdateBridge | undefined;
  dispatch: UpdateCommandDispatcher;
}
