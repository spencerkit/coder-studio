import type { LucideIcon, LucideProps } from "lucide-react";
import React from "react";
import {
  Archive, ArrowDownUp, ArrowUp, Blocks, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, Code, File, FileDiff, FileJson, FileText, Folder, FolderOpen, FolderPlus, GitBranch, List, Minus, Monitor, MoonStar, Palette, Plus, Rows3, Search, Settings2, SlidersHorizontal, SquarePlus, SunMedium, Terminal, Undo2, X, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, SquareSplitVertical, SquareSplitHorizontal
} from "lucide-react";

const createIcon = (Icon: LucideIcon, defaults?: Partial<LucideProps>) => {
  const WrappedIcon = (props: LucideProps) => <Icon aria-hidden="true" size={16} strokeWidth={1.5} {...defaults} {...props} />;
  WrappedIcon.displayName = `Icon(${Icon.displayName ?? Icon.name ?? "Lucide"})`;
  return WrappedIcon;
};

export const RailSessionsIcon = createIcon(Rows3);
export const RailFilesIcon = createIcon(FolderOpen);
export const RailGitIcon = createIcon(GitBranch);
export const WorkspaceFolderIcon = createIcon(Folder);
export const WorkspaceBranchIcon = createIcon(GitBranch);
export const WorkspaceGitIcon = createIcon(GitBranch);
export const WorkspaceChangesIcon = createIcon(FileDiff);
export const WorkspaceCodeIcon = createIcon(Code2);
export const WorkspaceTerminalIcon = createIcon(Terminal);
export const AgentSendIcon = createIcon(ArrowUp);
export const AgentPlusIcon = createIcon(Plus);
export const ThemeDarkIcon = createIcon(MoonStar);
export const ThemeLightIcon = createIcon(SunMedium);
export const ThreadAddIcon = createIcon(SquarePlus);
export const ThreadSortIcon = createIcon(ArrowDownUp);
export const WorkspaceGroupIcon = createIcon(FolderPlus);
export const HeaderAddIcon = createIcon(Plus);
export const HeaderCloseIcon = createIcon(X);
export const HeaderSettingsIcon = createIcon(Settings2);
export const HeaderBackIcon = createIcon(ChevronLeft);
export const SettingsGeneralIcon = createIcon(SlidersHorizontal);
export const SettingsConfigIcon = createIcon(List);
export const SettingsAppearanceIcon = createIcon(Palette);
export const SettingsMcpIcon = createIcon(Blocks);
export const SettingsGitIcon = createIcon(GitBranch);
export const SettingsEnvironmentIcon = createIcon(Monitor);
export const SettingsWorktreeIcon = createIcon(Folder);
export const SettingsArchiveIcon = createIcon(Archive);
export const GitStageIcon = createIcon(Check);
export const GitUnstageIcon = createIcon(Minus);
export const GitDiscardIcon = createIcon(Undo2);
export const WorkspaceAddIcon = createIcon(FolderPlus);

export const SearchIcon = createIcon(Search, { size: 14 });
export const ChevronRightIcon = createIcon(ChevronRight, { size: 12 });
export const ChevronDownIcon = createIcon(ChevronDown, { size: 12 });
export const MaximizeIcon = createIcon(Maximize2, { size: 14 });
export const MinimizeIcon = createIcon(Minimize2, { size: 14 });
export const PanelLeftCloseIcon = createIcon(PanelRightClose, { size: 14 });
export const PanelLeftOpenIcon = createIcon(PanelRightOpen, { size: 14 });
export const AgentSplitVerticalIcon = createIcon(SquareSplitVertical, { size: 13 });
export const AgentSplitHorizontalIcon = createIcon(SquareSplitHorizontal, { size: 13 });
export const FolderIcon = createIcon(Folder, { size: 14 });
export const FolderOpenIcon = createIcon(FolderOpen, { size: 14 });
export const FileIcon = createIcon(File, { size: 14 });

const fileTypeColors: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#f7df1e", jsx: "#f7df1e", json: "#cbcb41", md: "#519aba", html: "#e34c26", css: "#563d7c", scss: "#563d7c", py: "#3572A5", go: "#00ADD8", rs: "#dea584", java: "#b07219", sql: "#e38c00", sh: "#89e051", yml: "#cb171e", yaml: "#cb171e", toml: "#9c4121", svg: "#a0c4e3", png: "#a0c4e3", jpg: "#a0c4e3", pdf: "#b30b00"
};

export const getFileIcon = (filename: string, isFolder: boolean, isExpanded?: boolean): React.ReactNode => {
  if (isFolder) return isExpanded ? <FolderOpenIcon /> : <FolderIcon />;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const color = fileTypeColors[ext] || "#808080";
  return <File style={{ color, width: 14, height: 14, flexShrink: 0 }} />;
};
