import type { ExecTarget } from "../../state/workbench";
import type {
  CommandAvailability,
  FilesystemListResponse,
  ProviderRuntimePreview,
} from "../../types/app";
import { invokeRpc } from "./client";

export const listFilesystem = (target: ExecTarget, path?: string) =>
  invokeRpc<FilesystemListResponse>("filesystem_list", { target, path });

export const checkCommandAvailability = (command: string, target: ExecTarget, cwd?: string) =>
  invokeRpc<CommandAvailability>("command_exists", { command, target, cwd });

export const getProviderRuntimePreview = (provider: string, target: ExecTarget) =>
  invokeRpc<ProviderRuntimePreview>("provider_runtime_preview", { provider, target });
