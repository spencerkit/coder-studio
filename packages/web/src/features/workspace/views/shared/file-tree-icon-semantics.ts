import type { FileNode } from "@coder-studio/core";
import type { IconSemantic } from "../../../../theme";

export function getFileNodeSemantic(node: FileNode, isExpanded: boolean): IconSemantic {
  if (node.kind === "dir") {
    return isExpanded ? "file.folder.open" : "file.folder.closed";
  }

  const ext = node.name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "go":
    case "rs":
    case "java":
      return "file.type.code";
    case "json":
    case "yaml":
    case "yml":
    case "toml":
    case "lock":
      return "file.type.data";
    case "md":
    case "txt":
      return "file.type.doc";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "file.type.media";
    default:
      return "file.type.default";
  }
}
