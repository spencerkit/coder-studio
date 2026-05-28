import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowUpCircle,
  Bot,
  Download,
  Eye,
  File,
  FileCode2,
  FileJson2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  GitCompare,
  Globe,
  House,
  Image as ImageIcon,
  Info,
  Keyboard,
  Palette,
  PanelBottom,
  PanelLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Terminal,
  TriangleAlert,
  Upload,
  Zap,
} from "lucide-react";

export const ICON_SEMANTICS = [
  "file.folder.closed",
  "file.folder.open",
  "file.type.code",
  "file.type.data",
  "file.type.doc",
  "file.type.media",
  "file.type.default",
  "file.action.new",
  "file.action.newFolder",
  "file.action.search",
  "git.status.staged",
  "git.status.modified",
  "git.status.deleted",
  "git.status.untracked",
  "git.action.diff",
  "git.action.pull",
  "git.action.push",
  "git.action.refresh",
  "git.action.warning",
  "git.branch",
  "git.branch.create",
  "git.commit",
  "git.footer.branch",
  "git.footer.diff",
  "git.footer.push",
  "git.footer.pull",
  "git.footer.refresh",
  "worktree.action.new",
  "nav.settings",
  "nav.search",
  "nav.explorer",
  "nav.newWorkspace",
  "nav.panelFiles",
  "nav.panelTerminal",
  "nav.agent",
  "mobile.dock.agent",
  "mobile.dock.files",
  "mobile.dock.terminal",
  "nav.settings.general",
  "nav.settings.providers",
  "nav.settings.appearance",
  "nav.settings.shortcuts",
  "nav.settings.about",
  "nav.settings.diagnostics",
  "terminal.action.new",
  "workspace.launch.home",
  "state.success",
  "state.warning",
  "state.error",
  "state.info",
  "state.fileModified",
  "state.fileDeleted",
  "state.emptyTerminal",
  "state.emptyConfig",
  "state.configFile",
  "state.welcome.terminal",
  "state.welcome.workspace",
  "state.welcome.git",
  "state.welcome.lightning",
  "supervisor.mode.enable",
  "supervisor.mode.edit",
  "supervisor.entry",
  "supervisor.action.details",
  "supervisor.action.resume",
  "supervisor.action.pause",
  "supervisor.action.trigger",
  "agent.action.newSession",
  "agent.provider.claude",
  "agent.provider.codex",
] as const;

export type IconSemantic = (typeof ICON_SEMANTICS)[number];

export type IconTone =
  | "current"
  | "primary"
  | "secondary"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "file-folder"
  | "file-code"
  | "file-data"
  | "file-doc"
  | "file-media"
  | "file-default"
  | "git-staged"
  | "git-modified"
  | "git-deleted"
  | "git-untracked";

export type IconSurface = "none" | "subtle" | "accent" | "success" | "warning" | "error" | "info";

export interface IconPresentationDefinition {
  glyph: LucideIcon;
  tone: IconTone;
  surface?: IconSurface;
  strokeWidth?: number;
}

export interface IconThemeDefinition {
  icons: Record<IconSemantic, IconPresentationDefinition>;
}

export interface ResolvedIconPresentation {
  semantic: IconSemantic;
  Icon: LucideIcon;
  tone: IconTone;
  surface: IconSurface;
  strokeWidth?: number;
}

const iconThemeById = new Map<string, IconThemeDefinition>();

export const BASE_ICON_THEME: IconThemeDefinition = {
  icons: {
    "file.folder.closed": { glyph: Folder, tone: "file-folder" },
    "file.folder.open": { glyph: FolderOpen, tone: "file-folder" },
    "file.type.code": { glyph: FileCode2, tone: "file-code" },
    "file.type.data": { glyph: FileJson2, tone: "file-data" },
    "file.type.doc": { glyph: FileText, tone: "file-doc" },
    "file.type.media": { glyph: ImageIcon, tone: "file-media" },
    "file.type.default": { glyph: File, tone: "file-default" },
    "file.action.new": { glyph: FilePlus, tone: "secondary" },
    "file.action.newFolder": { glyph: FolderPlus, tone: "secondary" },
    "file.action.search": { glyph: Search, tone: "secondary" },
    "git.status.staged": { glyph: Plus, tone: "git-staged" },
    "git.status.modified": { glyph: GitBranch, tone: "git-modified" },
    "git.status.deleted": { glyph: TriangleAlert, tone: "git-deleted" },
    "git.status.untracked": { glyph: Plus, tone: "git-untracked" },
    "git.action.diff": { glyph: GitCompare, tone: "secondary" },
    "git.action.pull": { glyph: Download, tone: "secondary" },
    "git.action.push": { glyph: Upload, tone: "secondary" },
    "git.action.refresh": { glyph: RotateCcw, tone: "secondary" },
    "git.action.warning": { glyph: AlertTriangle, tone: "warning" },
    "git.branch": { glyph: GitBranch, tone: "secondary" },
    "git.branch.create": { glyph: Plus, tone: "secondary" },
    "git.commit": { glyph: ArrowUpCircle, tone: "secondary" },
    "git.footer.branch": { glyph: GitBranch, tone: "current" },
    "git.footer.diff": { glyph: GitCompare, tone: "warning" },
    "git.footer.push": { glyph: Upload, tone: "success" },
    "git.footer.pull": { glyph: Download, tone: "info" },
    "git.footer.refresh": { glyph: RotateCcw, tone: "secondary" },
    "worktree.action.new": { glyph: Plus, tone: "secondary" },
    "nav.settings": { glyph: Settings, tone: "secondary" },
    "nav.explorer": { glyph: FolderTree, tone: "secondary" },
    "nav.search": { glyph: Search, tone: "secondary" },
    "nav.newWorkspace": { glyph: Plus, tone: "secondary" },
    "nav.panelFiles": { glyph: PanelLeft, tone: "current" },
    "nav.panelTerminal": { glyph: PanelBottom, tone: "current" },
    "nav.agent": { glyph: Bot, tone: "current" },
    "mobile.dock.agent": { glyph: Bot, tone: "current" },
    "mobile.dock.files": { glyph: PanelLeft, tone: "current" },
    "mobile.dock.terminal": { glyph: PanelBottom, tone: "current" },
    "nav.settings.general": { glyph: Settings, tone: "secondary" },
    "nav.settings.providers": { glyph: Globe, tone: "secondary" },
    "nav.settings.appearance": { glyph: Palette, tone: "secondary" },
    "nav.settings.shortcuts": { glyph: Keyboard, tone: "secondary" },
    "nav.settings.about": { glyph: Info, tone: "secondary" },
    "nav.settings.diagnostics": { glyph: AlertTriangle, tone: "secondary" },
    "terminal.action.new": { glyph: Plus, tone: "secondary" },
    "workspace.launch.home": { glyph: House, tone: "secondary" },
    "state.success": { glyph: Info, tone: "success", surface: "success" },
    "state.warning": { glyph: AlertTriangle, tone: "warning", surface: "warning" },
    "state.error": { glyph: AlertTriangle, tone: "error", surface: "error" },
    "state.info": { glyph: Info, tone: "info", surface: "info" },
    "state.fileModified": { glyph: AlertTriangle, tone: "warning", surface: "none" },
    "state.fileDeleted": { glyph: AlertTriangle, tone: "error", surface: "none" },
    "state.emptyTerminal": { glyph: Terminal, tone: "muted", surface: "subtle" },
    "state.emptyConfig": { glyph: AlertTriangle, tone: "warning", surface: "subtle" },
    "state.configFile": { glyph: FileJson2, tone: "secondary" },
    "state.welcome.terminal": { glyph: Terminal, tone: "accent", surface: "accent" },
    "state.welcome.workspace": { glyph: Plus, tone: "accent", surface: "accent" },
    "state.welcome.git": { glyph: GitBranch, tone: "accent", surface: "accent" },
    "state.welcome.lightning": { glyph: Zap, tone: "accent", surface: "accent" },
    "supervisor.mode.enable": { glyph: Eye, tone: "secondary" },
    "supervisor.mode.edit": { glyph: Pencil, tone: "secondary" },
    "supervisor.entry": { glyph: Eye, tone: "accent" },
    "supervisor.action.details": { glyph: Info, tone: "secondary" },
    "supervisor.action.resume": { glyph: Play, tone: "secondary" },
    "supervisor.action.pause": { glyph: Pause, tone: "secondary" },
    "supervisor.action.trigger": { glyph: ArrowUpCircle, tone: "secondary" },
    "agent.action.newSession": { glyph: Plus, tone: "secondary" },
    "agent.provider.claude": { glyph: Sparkles, tone: "accent" },
    "agent.provider.codex": { glyph: Bot, tone: "secondary" },
  },
};

export function createIconTheme(
  overrides: Partial<Record<IconSemantic, IconPresentationDefinition>> = {}
): IconThemeDefinition {
  return {
    icons: {
      ...BASE_ICON_THEME.icons,
      ...overrides,
    },
  };
}

export function registerIconThemes(
  themes: ReadonlyArray<{ id: string; iconTheme: IconThemeDefinition }>
): void {
  iconThemeById.clear();

  for (const theme of themes) {
    iconThemeById.set(theme.id, theme.iconTheme);
  }
}

export function getIconPresentation(
  themeId: string,
  semantic: IconSemantic
): ResolvedIconPresentation {
  const theme = iconThemeById.get(themeId);
  const presentation = theme?.icons[semantic] ?? BASE_ICON_THEME.icons[semantic];

  return {
    semantic,
    Icon: presentation.glyph,
    tone: presentation.tone,
    surface: presentation.surface ?? "none",
    strokeWidth: presentation.strokeWidth,
  };
}
