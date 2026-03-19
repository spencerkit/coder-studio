import type { FilePreview } from "../../state/workbench";
import { invokeRpc } from "./client";

export const previewFile = (path: string) => invokeRpc<FilePreview>("file_preview", { path });
export const saveFile = (path: string, content: string) => invokeRpc<FilePreview>("file_save", { path, content });
