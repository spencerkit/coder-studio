import { THEME_IDS } from "../theme";

export type UiPreviewSceneDevice = "desktop" | "mobile";
export type UiPreviewSceneTheme = (typeof THEME_IDS)[number];
export type UiPreviewSceneLocale = "zh" | "en";
export type UiPreviewCategory =
  | "page"
  | "modal"
  | "sheet"
  | "toast"
  | "empty"
  | "error"
  | "loading";
export type UiPreviewSource = "real-route" | "showcase";
export type UiPreviewSettingsSection = "general" | "appearance" | "providers" | "shortcuts";

export interface UiPreviewSceneMetadata {
  id: string;
  title: string;
  category: UiPreviewCategory;
  source: UiPreviewSource;
  description: string;
  devices: UiPreviewSceneDevice[];
  themes: UiPreviewSceneTheme[];
  locales: UiPreviewSceneLocale[];
  capture?: {
    selector?: string;
    fullPage?: boolean;
    settingsSection?: UiPreviewSettingsSection;
  };
}

function allThemeIds(): UiPreviewSceneTheme[] {
  return [...THEME_IDS] as UiPreviewSceneTheme[];
}

export const UI_PREVIEW_SCENE_METADATA: UiPreviewSceneMetadata[] = [
  {
    id: "welcome",
    title: "Welcome",
    category: "page",
    source: "real-route",
    description: "Welcome page on the real / route under the preview harness.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".welcome-card" },
  },
  {
    id: "settings-general",
    title: "Settings / General",
    category: "page",
    source: "real-route",
    description: "Settings page at /settings with deterministic settings.get data.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".settings-page", settingsSection: "general" },
  },
  {
    id: "settings-appearance",
    title: "Settings / Appearance",
    category: "page",
    source: "real-route",
    description: "Settings appearance section using route-backed production UI.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".settings-page", settingsSection: "appearance" },
  },
  {
    id: "settings-providers",
    title: "Settings / Providers",
    category: "page",
    source: "real-route",
    description: "Settings providers section with fixed provider args.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".settings-page", settingsSection: "providers" },
  },
  {
    id: "settings-shortcuts",
    title: "Settings / Shortcuts",
    category: "page",
    source: "real-route",
    description: "Settings shortcuts section with the keyboard shortcut list and category tabs.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".settings-page", settingsSection: "shortcuts" },
  },
  {
    id: "settings-mobile-root",
    title: "Settings / Mobile Root",
    category: "page",
    source: "real-route",
    description: "Mobile settings root list before drilling into any subsection.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".settings-mobile-list" },
  },
  {
    id: "app-loading-shell",
    title: "App Loading Shell",
    category: "loading",
    source: "real-route",
    description: "Top-level shell shown while auth state is still unresolved before routes render.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".app-loading-shell" },
  },
  {
    id: "workspace-desktop",
    title: "Workspace / Desktop",
    category: "page",
    source: "real-route",
    description: "Desktop workspace shell with seeded workspace, git status, and file tree.",
    devices: ["desktop"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".workspace-page" },
  },
  {
    id: "workspace-mobile",
    title: "Workspace / Mobile",
    category: "page",
    source: "real-route",
    description: "Mobile workspace shell with seeded workspace and no active sessions.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: "[data-testid='mobile-shell']" },
  },
  {
    id: "auth-preview",
    title: "Auth Preview",
    category: "page",
    source: "real-route",
    description: "Login/auth page component on the real /login route under preview harness.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".auth-card-shell" },
  },
  {
    id: "not-found",
    title: "Not Found",
    category: "page",
    source: "real-route",
    description: "Not found page for an unknown route path.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".welcome-card" },
  },
  {
    id: "workspace-load-error",
    title: "Workspace / Load Error",
    category: "error",
    source: "real-route",
    description: "Shared workspace route error shell when workspace list loading fails.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".workspace-resolving-card" },
  },
  {
    id: "workspace-launch-modal",
    title: "Workspace Launch Modal",
    category: "modal",
    source: "showcase",
    description: "Workspace open modal with fixed browse/open responses.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".launch-modal, .mobile-sheet--launch" },
  },
  {
    id: "command-palette",
    title: "Command Palette",
    category: "modal",
    source: "showcase",
    description: "Command palette forced open with a seeded active workspace.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".command-palette, .command-palette-sheet" },
  },
  {
    id: "branch-quick-pick",
    title: "Branch Quick Pick",
    category: "sheet",
    source: "showcase",
    description: "Branch picker opened via seeded branchQuickPick atom and fake git.branches data.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".mobile-select-sheet--command" },
  },
  {
    id: "toast-stack",
    title: "Toast Stack",
    category: "toast",
    source: "showcase",
    description: "Success and error toasts for visual review.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".toast-container" },
  },
  {
    id: "workspace-icon-review",
    title: "Workspace Icon Review",
    category: "page",
    source: "showcase",
    description:
      "File tree, git states, terminal empty state, and mobile dock/supervisor icon surfaces for theme review.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".workspace-icon-review" },
  },
  {
    id: "toast-icon-review",
    title: "Toast Icon Review",
    category: "toast",
    source: "showcase",
    description:
      "Success, warning, error, and info toast icons rendered together for theme review.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".toast-container" },
  },
  {
    id: "supervisor-icon-review",
    title: "Supervisor Icon Review",
    category: "modal",
    source: "showcase",
    description: "Supervisor dialog header icon and destructive callout surface review.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".supervisor-dialog, .mobile-sheet__content" },
  },
  {
    id: "mobile-workspace-drawer",
    title: "Mobile Workspace Drawer",
    category: "sheet",
    source: "showcase",
    description: "Opened mobile workspace drawer with two example workspaces.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".mobile-workspace-drawer" },
  },
  {
    id: "mobile-files-sheet",
    title: "Mobile Files Sheet",
    category: "sheet",
    source: "showcase",
    description: "Static mobile files sheet chrome for screenshot comparison.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".mobile-sheet--files" },
  },
  {
    id: "mobile-terminal-sheet",
    title: "Mobile Terminal Sheet",
    category: "sheet",
    source: "showcase",
    description:
      "Mobile terminal fullscreen sheet using xterm placeholder chrome instead of live ws runtime.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".mobile-sheet--terminal" },
  },
  {
    id: "mobile-supervisor-sheet",
    title: "Mobile Supervisor Sheet",
    category: "sheet",
    source: "showcase",
    description: "Mobile supervisor sheet with a seeded supervisor state.",
    devices: ["mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".mobile-supervisor-sheet" },
  },
  {
    id: "supervisor-dialog",
    title: "Supervisor Dialog",
    category: "modal",
    source: "showcase",
    description: "Desktop supervisor objective dialog opened by atom seed.",
    devices: ["desktop"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".supervisor-dialog" },
  },
  {
    id: "worktree-manager",
    title: "Worktree Manager",
    category: "modal",
    source: "showcase",
    description: "Worktree manager surface with seeded worktree list, status, diff, and tree.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".worktree-manager-surface, .mobile-sheet--worktree" },
  },
  {
    id: "confirm-dialog-danger",
    title: "Confirm Dialog / Danger",
    category: "modal",
    source: "showcase",
    description: "Generic destructive confirm dialog for screenshot review.",
    devices: ["desktop"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".modal-card" },
  },
  {
    id: "provider-error-state",
    title: "Provider Error State",
    category: "error",
    source: "showcase",
    description: "Inline settings error state for provider/config failures.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".settings-page__notice" },
  },
  {
    id: "file-tree-delete-confirm",
    title: "File Tree / Delete Confirm",
    category: "modal",
    source: "showcase",
    description: "Shared destructive confirm dialog used by the file tree when deleting a file.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".modal-card" },
  },
  {
    id: "empty-state",
    title: "Empty State",
    category: "empty",
    source: "showcase",
    description: "Shared empty-state shell.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".welcome-card" },
  },
  {
    id: "loading-state",
    title: "Loading State",
    category: "loading",
    source: "showcase",
    description: "Workspace resolving/loading shell.",
    devices: ["desktop", "mobile"],
    themes: allThemeIds(),
    locales: ["zh", "en"],
    capture: { selector: ".workspace-resolving-card" },
  },
];

const UI_PREVIEW_SCENE_METADATA_MAP = new Map(
  UI_PREVIEW_SCENE_METADATA.map((scene) => [scene.id, scene])
);

export function getUiPreviewSceneMetadata(id: string): UiPreviewSceneMetadata | null {
  return UI_PREVIEW_SCENE_METADATA_MAP.get(id) ?? null;
}
