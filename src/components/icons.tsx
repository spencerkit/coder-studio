import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Archive,
  ArrowDownUp,
  ArrowUp,
  Blocks,
  Check,
  ChevronLeft,
  Code2,
  FileDiff,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  List,
  Minus,
  Monitor,
  MoonStar,
  Palette,
  Plus,
  Rows3,
  Settings2,
  SlidersHorizontal,
  SquarePlus,
  SunMedium,
  Terminal,
  Undo2,
  X
} from "lucide-react";

const createIcon = (Icon: LucideIcon, defaults?: Partial<LucideProps>) => {
  const WrappedIcon = (props: LucideProps) => (
    <Icon
      aria-hidden="true"
      size={18}
      strokeWidth={1.6}
      {...defaults}
      {...props}
    />
  );

  WrappedIcon.displayName = `Icon(${Icon.displayName ?? Icon.name ?? "Lucide"})`;

  return WrappedIcon;
};

export const RailSessionsIcon = createIcon(Rows3);
export const RailFilesIcon = createIcon(FolderOpen);
export const RailGitIcon = createIcon(GitBranch);

export const WorkspaceFolderIcon = createIcon(Folder);
export const WorkspaceBranchIcon = createIcon(GitBranch);
export const WorkspaceChangesIcon = createIcon(FileDiff);
export const WorkspaceCodeIcon = createIcon(Code2);
export const WorkspaceTerminalIcon = createIcon(Terminal);

export const AgentSendIcon = createIcon(ArrowUp);
export const AgentPlusIcon = createIcon(Plus);

export const ThemeDarkIcon = createIcon(MoonStar);
export const ThemeLightIcon = createIcon(SunMedium);

export const ThreadAddIcon = createIcon(SquarePlus);
export const ThreadSortIcon = createIcon(ArrowDownUp);
export const WorkspaceGroupIcon = createIcon(FolderTree);

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
export const SettingsWorktreeIcon = createIcon(FolderTree);
export const SettingsArchiveIcon = createIcon(Archive);

export const GitStageIcon = createIcon(Check);
export const GitUnstageIcon = createIcon(Minus);
export const GitDiscardIcon = createIcon(Undo2);

export const WorkspaceAddIcon = createIcon(FolderPlus);
