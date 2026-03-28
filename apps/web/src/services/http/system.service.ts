import type { ExecTarget } from "../../state/workbench";
import type { CommandAvailability, FilesystemListResponse } from "../../types/app";
import { invokeRpc } from "./client.ts";

export const listFilesystem = (target: ExecTarget, path?: string) =>
  invokeRpc<FilesystemListResponse>("filesystem_list", { target, path });

export const checkCommandAvailability = (command: string, target: ExecTarget, cwd?: string) =>
  invokeRpc<CommandAvailability>("command_exists", { command, target, cwd });
