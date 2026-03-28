import { useEffect } from "react";
import type { Translator } from "../../i18n";
import type { ExecTarget } from "../../state/workbench";
import type { FolderBrowserState } from "../../types/app";
import { ChevronRightIcon, HeaderCloseIcon, WorkspaceFolderIcon } from "../icons";

type WorkspaceLaunchOverlayProps = {
  visible: boolean;
  target: ExecTarget;
  input: string;
  canUseWsl: boolean;
  folderBrowser: FolderBrowserState;
  onUpdateTarget: (target: ExecTarget) => void;
  onBrowseDirectory: (path?: string, selectCurrent?: boolean) => void;
  onClose: () => void;
  onStartWorkspace: () => void;
  t: Translator;
};

export const WorkspaceLaunchOverlay = ({
  visible,
  target,
  input,
  canUseWsl,
  folderBrowser,
  onUpdateTarget,
  onBrowseDirectory,
  onClose,
  onStartWorkspace,
  t
}: WorkspaceLaunchOverlayProps) => {
  useEffect(() => {
    if (!visible) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const selectedPath = input.trim();
  const visibleRoots = folderBrowser.roots.filter(
    (root) => root.id !== "root" && root.path !== folderBrowser.homePath,
  );

  return (
    <div className="overlay" data-testid="overlay" onClick={onClose}>
      <div
        className="modal onboarding-modal launch-overlay-shell"
        data-testid="launch-overlay-shell"
        data-density="compact"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="onboarding-form">
          <div className="onboarding-header launch-overlay-header">
            <div className="launch-overlay-copy">
              <span className="section-kicker">{t("startWorkspace")}</span>
              <h2>{t("localFolder")}</h2>
              <p>{t("localFolderHint")}</p>
            </div>
            <div className="launch-overlay-header-actions">
              <button
                type="button"
                className="launch-overlay-close"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
                data-testid="launch-overlay-close"
              >
                <HeaderCloseIcon />
              </button>
              <div className="launch-overlay-meta">
                <div className="launch-overlay-meta-item">
                  <span className="section-kicker">{t("selected")}</span>
                  <strong>{selectedPath || folderBrowser.currentPath || t("loading")}</strong>
                </div>
                <div className="launch-overlay-meta-item">
                  <span className="section-kicker">{target.type === "wsl" ? "WSL" : t("nativeTarget")}</span>
                  <strong>{target.type === "wsl" ? (target.distro?.trim() || (t("nativeTarget") === "Native" ? "Default distro" : "默认发行版")) : t("nativeTarget")}</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="choice-grid">
            <div className="choice active" data-testid="choice-local-only">
              <strong>{t("localFolder")}</strong>
              <div className="hint">{t("localFolderHint")}</div>
            </div>
          </div>
          {canUseWsl && (
            <div className="choice-grid small launch-overlay-runtime">
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
          <div className="local-picker web-folder-picker" data-testid="folder-select">
            <div className="web-folder-picker-toolbar">
              <div className="web-folder-picker-paths">
                <div className="hint" data-testid="folder-selected">{t("selected")}</div>
                <strong>{selectedPath || folderBrowser.currentPath || t("loading")}</strong>
                <div className="web-folder-picker-tip">{t("folderBrowserInteractionHint")}</div>
              </div>
              <div className="web-folder-picker-actions">
                <button className="btn tiny ghost" type="button" onClick={() => onBrowseDirectory(folderBrowser.homePath || undefined, true)} disabled={folderBrowser.loading}>
                  {t("homeDirectory")}
                </button>
                <button className="btn tiny ghost" type="button" onClick={() => onBrowseDirectory(folderBrowser.parentPath, true)} disabled={folderBrowser.loading || !folderBrowser.parentPath}>
                  {t("goUp")}
                </button>
              </div>
            </div>
            {folderBrowser.notice && <div className="folder-browser-notice">{folderBrowser.notice}</div>}

            {visibleRoots.length > 0 && (
              <div className="web-folder-picker-roots">
                {visibleRoots.map((root) => (
                <button
                  key={root.id}
                  type="button"
                  className={`folder-root-chip ${selectedPath === root.path || folderBrowser.currentPath === root.path ? "active" : ""}`}
                  onClick={() => onBrowseDirectory(root.path, true)}
                  title={t("folderBrowserInteractionHint")}
                >
                  <span>{root.label}</span>
                  <small>{root.description}</small>
                </button>
                ))}
              </div>
            )}

            <div className="web-folder-picker-list">
              {folderBrowser.loading && <div className="tree-empty">{t("loadingDirectories")}</div>}
              {!folderBrowser.loading && folderBrowser.error && <div className="tree-empty">{folderBrowser.error}</div>}
              {!folderBrowser.loading && !folderBrowser.error && folderBrowser.entries.length === 0 && (
                <div className="tree-empty">{t("emptyDirectories")}</div>
              )}
              {!folderBrowser.loading && !folderBrowser.error && folderBrowser.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`folder-browser-row ${selectedPath === entry.path ? "selected" : ""}`}
                  onClick={() => onBrowseDirectory(entry.path, true)}
                  title={t("folderBrowserInteractionHint")}
                >
                  <span className="folder-browser-row-meta">
                    <span className="folder-browser-row-name">
                      <WorkspaceFolderIcon />
                      <span>{entry.name}</span>
                    </span>
                    <span className="folder-browser-row-hint">{t("folderBrowserRowHint")}</span>
                  </span>
                  <span className="folder-browser-row-action" aria-hidden="true">
                    <span>{t("enterFolder")}</span>
                    <ChevronRightIcon />
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={onStartWorkspace} data-testid="start-workspace" disabled={!selectedPath}>
              {t("startWorkspace")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceLaunchOverlay;
