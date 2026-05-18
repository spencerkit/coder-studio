import type { FileNode } from "@coder-studio/core";
import { type ReactNode, useMemo } from "react";
import { copyTextWithFallback } from "../../../lib/clipboard";
import { useTranslation } from "../../../lib/i18n";
import type { FileContextTarget } from "./use-file-tree-context-menu";

export interface FileContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface FileContextMenuSection {
  id: string;
  title: string;
  items: FileContextMenuItem[];
}

interface UseFileContextActionsArgs {
  workspacePath: string | null;
  target: FileContextTarget | null;
  createShellTerminal: (args?: { cwdPath?: string }) => void | Promise<unknown>;
  openCreateDialog: (mode: "file" | "folder", baseDir: string | null) => void;
  openRenameDialog: (args: { path: string; name: string; kind: "file" | "dir" }) => void;
  requestDelete: (args: { path: string; name: string; error: string | null }) => void;
}

function translateWithFallback(
  t: (key: string, params?: Record<string, string | number>) => string,
  key: string,
  fallback: string
) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function toAbsolutePath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes("\\") ? "\\" : "/";
  const normalizedBase = workspacePath.replace(/[\\/]+$/, "");
  const parts =
    relativePath === "."
      ? []
      : relativePath
          .split(/[\\/]+/)
          .map((part) => part.trim())
          .filter(Boolean);

  return parts.length > 0
    ? `${normalizedBase}${separator}${parts.join(separator)}`
    : normalizedBase;
}

export function getTerminalCwdPath(node: FileNode): string | undefined {
  if (node.kind === "dir") {
    return node.path === "." ? undefined : node.path;
  }

  const lastSeparatorIndex = Math.max(node.path.lastIndexOf("/"), node.path.lastIndexOf("\\"));
  if (lastSeparatorIndex <= 0) {
    return undefined;
  }

  return node.path.slice(0, lastSeparatorIndex);
}

export function useFileContextActions({
  workspacePath,
  target,
  createShellTerminal,
  openCreateDialog,
  openRenameDialog,
  requestDelete,
}: UseFileContextActionsArgs) {
  const t = useTranslation();

  return useMemo<FileContextMenuSection[]>(() => {
    if (!target) {
      return [];
    }

    const { node } = target;
    const relativePath = node.path;
    const absolutePath = workspacePath ? toAbsolutePath(workspacePath, relativePath) : null;
    const terminalCwdPath = getTerminalCwdPath(node);
    const sections: FileContextMenuSection[] = [];

    if (node.kind === "dir") {
      sections.push({
        id: "create",
        title: translateWithFallback(t, "file.context_section_create", "Create"),
        items: [
          {
            id: "new-file",
            label: translateWithFallback(t, "file.new_file", "New File"),
            onSelect: () => openCreateDialog("file", node.path),
          },
          {
            id: "new-folder",
            label: translateWithFallback(t, "file.new_folder", "New Folder"),
            onSelect: () => openCreateDialog("folder", node.path),
          },
        ],
      });
    }

    sections.push(
      {
        id: "edit",
        title: translateWithFallback(t, "file.context_section_edit", "Edit"),
        items: [
          {
            id: "rename",
            label: translateWithFallback(t, "file.rename", "Rename"),
            onSelect: () =>
              openRenameDialog({
                path: node.path,
                name: node.name,
                kind: node.kind,
              }),
          },
          {
            id: "delete",
            label: translateWithFallback(t, "file.delete", "Delete"),
            tone: "danger",
            onSelect: () => requestDelete({ path: node.path, name: node.name, error: null }),
          },
        ],
      },
      {
        id: "path",
        title: translateWithFallback(t, "file.context_section_path", "Path"),
        items: [
          {
            id: "copy-relative-path",
            label: translateWithFallback(t, "file.copy_relative_path", "Copy Relative Path"),
            onSelect: () => copyTextWithFallback(relativePath),
          },
          {
            id: "copy-absolute-path",
            label: translateWithFallback(t, "file.copy_absolute_path", "Copy Absolute Path"),
            disabled: !absolutePath,
            onSelect: () => (absolutePath ? copyTextWithFallback(absolutePath) : undefined),
          },
        ],
      },
      {
        id: "terminal",
        title: translateWithFallback(t, "file.context_section_terminal", "Terminal"),
        items: [
          {
            id: "open-in-terminal",
            label: translateWithFallback(t, "file.open_in_terminal", "Open in Terminal"),
            onSelect: () =>
              createShellTerminal(terminalCwdPath ? { cwdPath: terminalCwdPath } : {}),
          },
        ],
      }
    );

    return sections;
  }, [
    createShellTerminal,
    openCreateDialog,
    openRenameDialog,
    requestDelete,
    t,
    target,
    workspacePath,
  ]);
}
