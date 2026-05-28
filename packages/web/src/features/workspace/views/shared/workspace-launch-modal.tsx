import { ArrowUp, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import {
  EmptyState,
  IconButton,
  Input,
  Sheet,
  Spinner,
  ThemedIcon,
  WorkbenchLayer,
} from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
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
  const t = useTranslation();
  const createFolderInputRef = useRef<HTMLInputElement | null>(null);
  const {
    browsing,
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
    isCreatingFolder,
    launchHint,
    launchTitle,
    loading,
    newFolderName,
    openCreateFolder,
    parentPath,
    rootPaths,
    selectedPath,
    submitCreateFolder,
    updateNewFolderName,
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

  const launchBody = (
    <div className="launch-body">
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
        disabled={loading || !selectedPath}
      >
        {loading ? t("workspace.launch.starting") : t("workspace.launch.start")}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet
        title={launchTitle}
        body={launchBody}
        footer={launchFooter}
        fullscreen
        bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen mobile-launch-sheet"
        contentClassName="mobile-sheet--launch"
        onClose={onClose}
      />
    );
  }

  return (
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
            disabled={loading || !selectedPath}
          >
            {loading ? t("workspace.launch.starting") : t("workspace.launch.start")}
          </button>
        </div>
      </div>
    </WorkbenchLayer>
  );
}

export default WorkspaceLaunchModal;
