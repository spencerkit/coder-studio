import type { GitStatus } from "@coder-studio/core";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Diff, X } from "lucide-react";
import { type FC, useLayoutEffect, useState } from "react";
import { Input } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useGitSyncActions } from "../../actions/use-git-actions";

interface GitStatusBarProps {
  workspaceId: string;
  gitState: GitStatus | null;
  inline?: boolean;
}

type GitSyncIntent = "push" | "pull";

interface SyncDialogState {
  intent: GitSyncIntent;
  count: number;
}

export const GitStatusBar: FC<GitStatusBarProps> = ({ workspaceId, gitState, inline = false }) => {
  const t = useTranslation();
  const {
    authPrompt,
    clearAuthPrompt,
    getAuthPromptMessage,
    handlePull,
    handlePush,
    syncingIntent,
  } = useGitSyncActions(workspaceId);
  const authFormId = `git-auth-form-${workspaceId}`;
  const [pendingAction, setPendingAction] = useState<SyncDialogState | null>(null);
  const [credentials, setCredentials] = useState({ username: "", password: "" });

  useLayoutEffect(() => {
    if (!authPrompt) {
      setCredentials({ username: "", password: "" });
      return;
    }

    setCredentials((previous) => ({
      username: previous.username || authPrompt.details.usernameHint || "",
      password: "",
    }));
  }, [authPrompt]);

  if (!gitState) {
    return null;
  }

  const changeCount =
    gitState.staged.length +
    gitState.modified.length +
    gitState.untracked.length +
    gitState.deleted.length;

  const ahead = gitState.ahead;
  const behind = gitState.behind;
  const confirmTitle =
    pendingAction?.intent === "push" ? t("git.push_confirm_title") : t("git.pull_confirm_title");
  const confirmMessage =
    pendingAction?.intent === "push"
      ? t("git.push_confirm_message", { count: pendingAction.count })
      : t("git.pull_confirm_message", { count: pendingAction?.count ?? 0 });
  const confirmActionLabel = pendingAction?.intent === "push" ? t("action.push") : t("action.pull");
  const confirmActionBusyLabel =
    pendingAction?.intent === "push" ? t("git.push_in_progress") : t("git.pull_in_progress");
  const isSyncingCurrentAction = Boolean(pendingAction && syncingIntent === pendingAction.intent);
  const authIntent = authPrompt?.intent;
  const authActionLabel = authIntent === "push" ? t("action.push") : t("action.pull");
  const authBusyLabel =
    authIntent === "push" ? t("git.push_in_progress") : t("git.pull_in_progress");
  const isSyncingAuthAction = Boolean(authIntent && syncingIntent === authIntent);
  const isDialogLocked = isSyncingCurrentAction || isSyncingAuthAction;

  const openConfirm = (intent: GitSyncIntent, count: number) => {
    if (count <= 0) {
      return;
    }

    setPendingAction({ intent, count });
  };

  const closeConfirm = () => {
    if (isDialogLocked) {
      return;
    }
    setPendingAction(null);
    clearAuthPrompt();
  };

  const confirmSync = async () => {
    if (!pendingAction) {
      return;
    }

    if (pendingAction.intent === "push") {
      const success = await handlePush();
      if (success) {
        setPendingAction(null);
      }
      return;
    }

    const success = await handlePull();
    if (success) {
      setPendingAction(null);
    }
  };

  const submitAuth = async () => {
    if (!authPrompt) {
      return;
    }

    const auth = {
      username: credentials.username.trim(),
      password: credentials.password,
    };

    if (!auth.username || !auth.password) {
      return;
    }

    const success = authPrompt.intent === "push" ? await handlePush(auth) : await handlePull(auth);

    if (success) {
      clearAuthPrompt();
      setPendingAction(null);
    }
  };

  return (
    <>
      <div className={`git-status-bar${inline ? " git-status-bar--inline" : ""}`}>
        <span className="git-status-bar__item" title={t("git.statusbar.changes")}>
          <Diff size={13} aria-hidden="true" />
          <span className="git-status-bar__value">{changeCount}</span>
        </span>
        <button
          className="git-status-bar__item git-status-bar__item--actionable git-status-bar__item--ahead"
          title={t("git.statusbar.ahead")}
          type="button"
          aria-label={t("action.push")}
          disabled={ahead <= 0}
          onClick={() => openConfirm("push", ahead)}
        >
          <ArrowUpFromLine size={13} aria-hidden="true" />
          <span className="git-status-bar__value">{ahead}</span>
        </button>
        <button
          className="git-status-bar__item git-status-bar__item--actionable git-status-bar__item--behind"
          title={t("git.statusbar.behind")}
          type="button"
          aria-label={t("action.pull")}
          disabled={behind <= 0}
          onClick={() => openConfirm("pull", behind)}
        >
          <ArrowDownToLine size={13} aria-hidden="true" />
          <span className="git-status-bar__value">{behind}</span>
        </button>
      </div>

      {pendingAction ? (
        <div className="modal-overlay" onClick={closeConfirm}>
          <div
            className="modal-card git-status-bar__confirm"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <AlertTriangle size={16} />
                <h3>{confirmTitle}</h3>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={closeConfirm}
                aria-label={t("action.close")}
                type="button"
                disabled={isDialogLocked}
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              {authPrompt ? (
                authPrompt.details.canPrompt ? (
                  <form
                    id={authFormId}
                    className="form-group"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitAuth();
                    }}
                  >
                    <p>{getAuthPromptMessage(authPrompt.details)}</p>
                    <span className="dialog-helper">{t("git.auth_helper_http")}</span>
                    <label htmlFor={`git-auth-username-${workspaceId}`}>
                      {t("git.auth_username")}
                    </label>
                    <Input
                      id={`git-auth-username-${workspaceId}`}
                      value={credentials.username}
                      onChange={(event) =>
                        setCredentials((previous) => ({
                          ...previous,
                          username: event.target.value,
                        }))
                      }
                      placeholder={
                        authPrompt.details.usernameHint ?? t("git.auth_username_placeholder")
                      }
                      autoFocus
                      disabled={isSyncingAuthAction}
                    />
                    <label htmlFor={`git-auth-password-${workspaceId}`}>
                      {t("git.auth_password")}
                    </label>
                    <Input
                      id={`git-auth-password-${workspaceId}`}
                      type="password"
                      value={credentials.password}
                      onChange={(event) =>
                        setCredentials((previous) => ({
                          ...previous,
                          password: event.target.value,
                        }))
                      }
                      placeholder={t("git.auth_password_placeholder")}
                      disabled={isSyncingAuthAction}
                    />
                  </form>
                ) : (
                  <div className="form-group">
                    <p>{getAuthPromptMessage(authPrompt.details)}</p>
                    <span className="dialog-helper">{t("git.auth_helper_unsupported")}</span>
                  </div>
                )
              ) : (
                <>
                  <p>{confirmMessage}</p>
                  <p className="dialog-helper">{t("git.sync_confirm_helper")}</p>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={closeConfirm}
                type="button"
                disabled={isDialogLocked}
              >
                {t("action.cancel")}
              </button>
              {authPrompt ? (
                <button
                  className="btn btn-primary"
                  form={authPrompt.details.canPrompt ? authFormId : undefined}
                  type={authPrompt.details.canPrompt ? "submit" : "button"}
                  disabled={
                    !authPrompt.details.canPrompt ||
                    isSyncingAuthAction ||
                    !credentials.username.trim() ||
                    !credentials.password
                  }
                >
                  {isSyncingAuthAction ? authBusyLabel : authActionLabel}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => void confirmSync()}
                  type="button"
                  disabled={isSyncingCurrentAction}
                >
                  {isSyncingCurrentAction ? confirmActionBusyLabel : confirmActionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default GitStatusBar;
