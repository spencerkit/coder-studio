import { useAtomValue } from "jotai";
import { ArrowUp, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import {
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Select,
  Sheet,
  Spinner,
  ThemedIcon,
  WorkbenchLayer,
} from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { formatDate, type LocaleCode, useTranslation } from "../../../../lib/i18n";
import { useWorkspaceLaunchActions } from "../../actions/use-workspace-launch-actions";

interface WorkspaceLaunchModalProps {
  onClose: () => void;
}

const directoryEmptyStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-6)",
  gap: 0,
};

const directoryLoadingStateStyle = {
  padding: "var(--sp-8)",
  gap: "var(--sp-2)",
};

const directoryEmptyStateTitleStyle = {
  margin: 0,
  color: "var(--text-tertiary)",
  fontWeight: "var(--font-normal)",
};

const visuallyHiddenTitleStyle = {
  position: "absolute" as const,
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap" as const,
  border: 0,
};

export function WorkspaceLaunchModal({ onClose }: WorkspaceLaunchModalProps) {
  const isMobile = useViewport() === "mobile";
  const locale = useAtomValue(localeAtom) as LocaleCode;
  const t = useTranslation();
  const createFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [showClearRecentConfirm, setShowClearRecentConfirm] = useState(false);
  const {
    browsing,
    canOpen,
    clearRecentWorkspaces,
    closeCreateFolder,
    currentPath,
    createFolderError,
    creatingFolder,
    directories,
    error,
    getShortPath,
    handleNavigate,
    handleOpen,
    handleSelect,
    historyLoading,
    isCreatingFolder,
    launchHint,
    launchTitle,
    loading,
    newFolderName,
    openCreateFolder,
    openWorkspaceByPath,
    parentPath,
    recentWorkspaces,
    rootPaths,
    removeRecentWorkspace,
    selectedPath,
    setTargetRuntime,
    setWslDistro,
    setWslPath,
    submitCreateFolder,
    isWindowsPlatform,
    targetRuntime,
    updateNewFolderName,
    wslDistro,
    wslDistros,
    wslDistrosError,
    wslDistrosLoading,
    wslPath,
  } = useWorkspaceLaunchActions(onClose);

  useLayoutEffect(() => {
    if (!isCreatingFolder) {
      return;
    }

    const input = createFolderInputRef.current;
    if (!input) {
      return;
    }

    const focusInput = () => {
      input.focus();
    };

    focusInput();

    if (document.activeElement === input) {
      return;
    }

    const timeoutId = window.setTimeout(focusInput, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isCreatingFolder]);

  const recentSection =
    !historyLoading && recentWorkspaces.length > 0 ? (
      <section className="launch-recent" aria-labelledby="launch-recent-title">
        <div className="launch-section-header">
          <div className="launch-section-title" id="launch-recent-title">
            {t("workspace.launch.recent_title")}
          </div>
          <button
            type="button"
            className="launch-section-action"
            onClick={() => setShowClearRecentConfirm(true)}
            disabled={loading}
            aria-label={t("workspace.launch.clear_recent_workspaces")}
          >
            {t("workspace.launch.clear_all")}
          </button>
        </div>
        <div className="launch-recent-list">
          {recentWorkspaces.map((entry) => (
            <div key={entry.path} className="launch-recent-item">
              <IconButton
                aria-label={t("workspace.launch.remove_recent", { name: entry.name })}
                className="launch-recent-remove"
                disabled={loading}
                icon={<X size={14} />}
                size="sm"
                onClick={() => {
                  void removeRecentWorkspace(entry.path);
                }}
              />
              <button
                className="launch-recent-row"
                type="button"
                aria-label={t("workspace.launch.open_recent", { name: entry.name })}
                disabled={loading}
                onClick={() => void openWorkspaceByPath(entry.path)}
              >
                <span className="launch-recent-row__header">
                  <span className="launch-recent-row__name">{entry.name}</span>
                  <span className="launch-recent-row__time">
                    {formatDate(entry.lastOpenedAt, locale)}
                  </span>
                </span>
                <span className="launch-recent-row__path">{entry.path}</span>
              </button>
            </div>
          ))}
        </div>
      </section>
    ) : null;

  const runtimeSection = isWindowsPlatform ? (
    <section className="launch-runtime">
      <label className="launch-runtime__label" htmlFor="workspace-runtime-select">
        {t("workspace.launch.runtime_label")}
      </label>
      <Select
        id="workspace-runtime-select"
        aria-label={t("workspace.launch.runtime_label")}
        options={[
          { value: "native", label: t("workspace.launch.runtime_native_windows") },
          { value: "wsl", label: t("workspace.launch.runtime_wsl") },
        ]}
        value={targetRuntime}
        onValueChange={(value) => setTargetRuntime(value)}
      />
    </section>
  ) : null;

  const nativeFolderPicker = (
    <div className="folder-picker">
      <div className="fp-toolbar">
        <button className="fp-btn" onClick={() => handleNavigate("~")}>
          <ThemedIcon semantic="workspace.launch.home" size={12} />
          {t("workspace.launch.home_directory")}
        </button>
        {parentPath && (
          <button className="fp-btn" onClick={() => handleNavigate(parentPath)}>
            <ArrowUp size={12} />
            {t("workspace.launch.go_up")}
          </button>
        )}
        <button className="fp-btn" type="button" onClick={openCreateFolder}>
          {t("workspace.launch.new_folder")}
        </button>
      </div>

      <div className="fp-root-chips">
        {rootPaths.map((rp) => (
          <span
            key={rp}
            className={`fp-chip ${currentPath === rp ? "active" : ""}`}
            onClick={() => handleNavigate(rp)}
          >
            {getShortPath(rp)}
          </span>
        ))}
        {currentPath && !rootPaths.includes(currentPath) && (
          <span className="fp-chip active">{getShortPath(currentPath)}</span>
        )}
      </div>

      {isCreatingFolder && (
        <div className="fp-create-folder">
          <Input
            ref={createFolderInputRef}
            aria-label={t("workspace.launch.folder_name_label")}
            className="fp-create-folder__input"
            disabled={creatingFolder}
            invalid={Boolean(createFolderError)}
            onChange={(event) => updateNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitCreateFolder();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeCreateFolder();
              }
            }}
            placeholder={t("workspace.launch.new_folder_placeholder")}
            value={newFolderName}
          />
          <button
            className="fp-create-folder__action"
            type="button"
            onClick={() => void submitCreateFolder()}
            disabled={creatingFolder}
          >
            {creatingFolder
              ? t("workspace.launch.creating_folder")
              : t("workspace.launch.create_folder")}
          </button>
          <button
            className="fp-create-folder__cancel"
            type="button"
            onClick={closeCreateFolder}
            disabled={creatingFolder}
          >
            {t("workspace.launch.create_folder_cancel")}
          </button>
          {createFolderError && <div className="form-error">{createFolderError}</div>}
        </div>
      )}

      <div className="fp-dir-list">
        {browsing ? (
          <EmptyState
            className="directory-loading"
            icon={<Spinner label={t("common.loading")} />}
            style={directoryLoadingStateStyle}
            title={<span style={visuallyHiddenTitleStyle}>{t("common.loading")}</span>}
          />
        ) : directories.length === 0 ? (
          <EmptyState
            className="directory-empty"
            style={directoryEmptyStateStyle}
            title={
              <p style={directoryEmptyStateTitleStyle}>{t("workspace.launch.no_directories")}</p>
            }
          />
        ) : (
          directories.map((dir) => (
            <div
              key={dir.path}
              className={`fp-dir ${selectedPath === dir.path ? "selected" : ""}`}
              onClick={() => handleSelect(dir.path)}
              onDoubleClick={() => handleNavigate(dir.path)}
            >
              <span className="fp-dir-icon">
                <ThemedIcon semantic="file.folder.closed" size={14} />
              </span>
              <span className={`fp-dir-name ${selectedPath === dir.path ? "selected" : ""}`}>
                {dir.name}
              </span>
              {dir.itemCount !== undefined && (
                <span className="fp-dir-hint">
                  {t("workspace.launch.items_count", { count: dir.itemCount })}
                </span>
              )}
              {selectedPath === dir.path && (
                <button
                  className="fp-dir-action"
                  type="button"
                  aria-label={t("workspace.launch.enter_folder", { name: dir.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNavigate(dir.path);
                  }}
                >
                  {t("workspace.launch.enter_folder_action")}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const wslLaunchSection =
    isWindowsPlatform && targetRuntime === "wsl" ? (
      <div className="launch-wsl">
        <label className="launch-runtime__label" htmlFor="workspace-wsl-distro">
          {t("workspace.launch.wsl_distro_label")}
        </label>
        <Select
          id="workspace-wsl-distro"
          aria-label={t("workspace.launch.wsl_distro_label")}
          options={wslDistros.map((distro) => ({ value: distro, label: distro }))}
          value={wslDistro}
          disabled={wslDistrosLoading || wslDistros.length === 0}
          onValueChange={(value) => setWslDistro(value)}
        />
        <label className="launch-runtime__label" htmlFor="workspace-wsl-path">
          {t("workspace.launch.wsl_path_label")}
        </label>
        <Input
          id="workspace-wsl-path"
          aria-label={t("workspace.launch.wsl_path_label")}
          placeholder={t("workspace.launch.wsl_path_placeholder")}
          value={wslPath}
          onChange={(event) => setWslPath(event.target.value)}
        />
        {wslDistrosError ? <div className="form-error">{wslDistrosError}</div> : null}
        {!wslDistrosLoading && wslDistros.length === 0 && !wslDistrosError ? (
          <div className="form-error">{t("workspace.launch.wsl_no_distros")}</div>
        ) : null}
      </div>
    ) : null;

  const launchBody = (
    <div className="launch-body">
      {recentSection}
      {runtimeSection}
      {wslLaunchSection ?? nativeFolderPicker}

      {error && (
        <div className="form-error" style={{ marginTop: "var(--sp-3)" }}>
          {error}
        </div>
      )}
    </div>
  );

  const launchFooter = (
    <div className="mobile-launch-sheet__footer">
      <button
        className="launch-start-btn launch-start-btn--mobile"
        onClick={() => void handleOpen()}
        disabled={loading || !canOpen}
      >
        {loading ? t("workspace.launch.starting") : t("workspace.launch.start")}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <Sheet
          title={launchTitle}
          body={launchBody}
          footer={launchFooter}
          fullscreen
          bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen mobile-launch-sheet"
          contentClassName="mobile-sheet--launch"
          onClose={onClose}
        />

        {showClearRecentConfirm ? (
          <ConfirmDialog
            open
            onOpenChange={setShowClearRecentConfirm}
            title={t("workspace.launch.clear_recent_confirm_title")}
            description={t("workspace.launch.clear_recent_confirm_description")}
            cancelText={t("action.cancel")}
            confirmText={t("workspace.launch.clear_all")}
            tone="danger"
            onConfirm={() => {
              void clearRecentWorkspaces();
              setShowClearRecentConfirm(false);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <WorkbenchLayer
        ariaLabel={launchTitle}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        open
      >
        <div className="launch-modal">
          <div className="launch-header">
            <div className="launch-header-left">
              <div className="launch-title">{launchTitle}</div>
              <div className="launch-hint">{launchHint}</div>
            </div>
            <div className="launch-header-right">
              <IconButton
                aria-label={t("action.close")}
                className="launch-close-btn"
                icon={<X size={16} />}
                onClick={onClose}
                size="sm"
              />
            </div>
          </div>

          {launchBody}

          <div className="launch-footer">
            <button
              className="launch-start-btn launch-start-btn--desktop"
              onClick={() => void handleOpen()}
              disabled={loading || !canOpen}
            >
              {loading ? t("workspace.launch.starting") : t("workspace.launch.start")}
            </button>
          </div>
        </div>
      </WorkbenchLayer>

      {showClearRecentConfirm ? (
        <ConfirmDialog
          open
          onOpenChange={setShowClearRecentConfirm}
          title={t("workspace.launch.clear_recent_confirm_title")}
          description={t("workspace.launch.clear_recent_confirm_description")}
          cancelText={t("action.cancel")}
          confirmText={t("workspace.launch.clear_all")}
          tone="danger"
          onConfirm={() => {
            void clearRecentWorkspaces();
            setShowClearRecentConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}

export default WorkspaceLaunchModal;
