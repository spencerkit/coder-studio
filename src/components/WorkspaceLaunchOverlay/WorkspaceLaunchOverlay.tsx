import type { Locale, Translator } from "../../i18n";
import type { ExecTarget } from "../../state/workbench";
import type { FolderBrowserState } from "../../types/app";
import { WorkspaceFolderIcon } from "../icons";

type WorkspaceLaunchOverlayProps = {
  visible: boolean;
  locale: Locale;
  mode: "remote" | "local";
  target: ExecTarget;
  input: string;
  canUseWsl: boolean;
  folderBrowser: FolderBrowserState;
  onSelectMode: (mode: "remote" | "local") => void;
  onUpdateTarget: (target: ExecTarget) => void;
  onUpdateInput: (value: string) => void;
  onBrowseDirectory: (path?: string, selectCurrent?: boolean) => void;
  onSelectDirectory: (path: string) => void;
  onCancel: () => void;
  onStartWorkspace: () => void;
  t: Translator;
};

export const WorkspaceLaunchOverlay = ({
  visible,
  locale,
  mode,
  target,
  input,
  canUseWsl,
  folderBrowser,
  onSelectMode,
  onUpdateTarget,
  onUpdateInput,
  onBrowseDirectory,
  onSelectDirectory,
  onCancel,
  onStartWorkspace,
  t
}: WorkspaceLaunchOverlayProps) => {
  if (!visible) return null;

  return (
    <div className="overlay" data-testid="overlay">
      <div className="modal onboarding-modal">
        <div className="onboarding-form">
          <div className="onboarding-header">
            <div className="section-kicker">{t("launchWorkspace")}</div>
            <h2>{t("launchWorkspaceTitle")}</h2>
            <p>{t("launchWorkspaceDescription")}</p>
          </div>
          <div className="choice-grid">
            <div className={`choice ${mode === "remote" ? "active" : ""}`} onClick={() => onSelectMode("remote")} data-testid="choice-remote">
              <strong>{t("remoteGit")}</strong>
              <div className="hint">{t("remoteGitHint")}</div>
            </div>
            <div className={`choice ${mode === "local" ? "active" : ""}`} onClick={() => onSelectMode("local")} data-testid="choice-local">
              <strong>{t("localFolder")}</strong>
              <div className="hint">{t("localFolderHint")}</div>
            </div>
          </div>
          {canUseWsl && (
            <div className="choice-grid small">
              <div className={`choice ${target.type === "native" ? "active" : ""}`} onClick={() => onUpdateTarget({ type: "native" })}>
                <strong>{t("nativeTarget")}</strong>
                <div className="hint">{t("nativeTargetHint")}</div>
              </div>
              <div className={`choice ${target.type === "wsl" ? "active" : ""}`} onClick={() => onUpdateTarget({ type: "wsl" })}>
                <strong>WSL</strong>
                <div className="hint">{t("wslHint")}</div>
              </div>
            </div>
          )}
          {canUseWsl && target.type === "wsl" && (
            <input
              value={target.distro ?? ""}
              onChange={(event) => onUpdateTarget({ type: "wsl", distro: event.target.value })}
              placeholder={t("optionalDistroPlaceholder")}
            />
          )}
          {mode === "remote" ? (
            <input
              value={input}
              onChange={(event) => onUpdateInput(event.target.value)}
              placeholder={t("pasteGitUrl")}
              data-testid="git-input"
            />
          ) : (
            <div className="local-picker web-folder-picker" data-testid="folder-select">
              <div className="web-folder-picker-toolbar">
                <div className="web-folder-picker-paths">
                  <div className="hint">{locale === "zh" ? "浏览位置" : "Browsing"}</div>
                  <strong>{folderBrowser.currentPath || input || (locale === "zh" ? "正在加载…" : "Loading...")}</strong>
                  <div className="hint" data-testid="folder-selected">{t("selected")}: {input || t("notSelected")}</div>
                </div>
                <div className="web-folder-picker-actions">
                  <button className="btn tiny ghost" type="button" onClick={() => onBrowseDirectory(folderBrowser.homePath || undefined, true)} disabled={folderBrowser.loading}>
                    {locale === "zh" ? "Home" : "Home"}
                  </button>
                  <button className="btn tiny ghost" type="button" onClick={() => onBrowseDirectory(folderBrowser.parentPath)} disabled={folderBrowser.loading || !folderBrowser.parentPath}>
                    {locale === "zh" ? "上一级" : "Up"}
                  </button>
                  <button className="btn tiny primary" type="button" onClick={() => onSelectDirectory(folderBrowser.currentPath)} disabled={!folderBrowser.currentPath}>
                    {locale === "zh" ? "选择当前目录" : "Use Current Folder"}
                  </button>
                </div>
              </div>
              {folderBrowser.notice && <div className="folder-browser-notice">{folderBrowser.notice}</div>}

              <div className="web-folder-picker-roots">
                {folderBrowser.roots.map((root) => (
                  <button
                    key={root.id}
                    type="button"
                    className={`folder-root-chip ${input === root.path || folderBrowser.currentPath === root.path ? "active" : ""}`}
                    onClick={() => onBrowseDirectory(root.path, true)}
                  >
                    <span>{root.label}</span>
                    <small>{root.description}</small>
                  </button>
                ))}
              </div>

              <div className="web-folder-picker-list">
                {folderBrowser.loading && <div className="tree-empty">{locale === "zh" ? "正在读取服务端目录…" : "Loading server directories..."}</div>}
                {!folderBrowser.loading && folderBrowser.error && <div className="tree-empty">{folderBrowser.error}</div>}
                {!folderBrowser.loading && !folderBrowser.error && folderBrowser.entries.length === 0 && (
                  <div className="tree-empty">{locale === "zh" ? "当前目录下没有可进入的子目录" : "No subdirectories in this location"}</div>
                )}
                {!folderBrowser.loading && !folderBrowser.error && folderBrowser.entries.map((entry) => (
                  <div key={entry.path} className={`folder-browser-row ${input === entry.path ? "selected" : ""}`}>
                    <button type="button" className="folder-browser-open" onClick={() => onBrowseDirectory(entry.path)}>
                      <WorkspaceFolderIcon />
                      <span>{entry.name}</span>
                    </button>
                    <button type="button" className="btn tiny ghost" onClick={() => onSelectDirectory(entry.path)}>
                      {locale === "zh" ? "选择" : "Select"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={onCancel}>{t("cancel")}</button>
            <button className="btn primary" onClick={onStartWorkspace} data-testid="start-workspace">{t("startWorkspace")}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceLaunchOverlay;
