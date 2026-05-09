import type { GitStatus } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Diff, RefreshCw, X } from "lucide-react";
import { type FC, useLayoutEffect, useState } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import {
  Button,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
} from "../../../../components/ui";
import { formatDate, type LocaleCode, useTranslation } from "../../../../lib/i18n";
import { useGitSyncActions } from "../../actions/use-git-actions";
import { gitFetchAtomFamily } from "../../atoms";

interface GitStatusBarProps {
  workspaceId: string;
  gitState: GitStatus | null;
  inline?: boolean;
  onRefresh?: () => void;
}

type GitSyncIntent = "push" | "pull";

interface SyncDialogState {
  intent: GitSyncIntent;
  count: number;
}

export const GitStatusBar: FC<GitStatusBarProps> = ({
  workspaceId,
  gitState,
  inline = false,
  onRefresh,
}) => {
  const t = useTranslation();
  const locale = useAtomValue(localeAtom) as LocaleCode;
  const fetchState = useAtomValue(gitFetchAtomFamily(workspaceId));
  const {
    authPrompt,
    clearAuthPrompt,
    getAuthPromptMessage,
    handleFetch,
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
  const isFetching = fetchState.status === "fetching";
  const fetchTitle = fetchState.lastFetchAt
    ? t("git.fetch_last_at", {
        when: formatDate(fetchState.lastFetchAt, locale),
      })
    : t("git.fetch_last_never");
  const fetchAriaLabel = isFetching ? t("git.fetch_in_progress") : t("git.fetch_label");
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
  const dialogIntent = authIntent ?? pendingAction?.intent ?? "pull";
  const authActionLabel =
    authIntent === "push"
      ? t("action.push")
      : authIntent === "pull"
        ? t("action.pull")
        : t("git.fetch_label");
  const authBusyLabel =
    authIntent === "push"
      ? t("git.push_in_progress")
      : authIntent === "pull"
        ? t("git.pull_in_progress")
        : t("git.fetch_in_progress");
  const isSyncingAuthAction = Boolean(authIntent && syncingIntent === authIntent);
  const isDialogLocked = isSyncingCurrentAction || isSyncingAuthAction;
  const isDialogOpen = Boolean(pendingAction || authPrompt);

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

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeConfirm();
    }
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

    const success =
      authPrompt.intent === "push"
        ? await handlePush(auth)
        : authPrompt.intent === "pull"
          ? await handlePull(auth)
          : await handleFetch(auth);

    if (success) {
      clearAuthPrompt();
      setPendingAction(null);
      onRefresh?.();
    }
  };

  const refreshAfterFetch = async () => {
    const success = await handleFetch();
    if (success) {
      onRefresh?.();
    }
  };

  return (
    <>
      <div className={`git-status-bar${inline ? " git-status-bar--inline" : ""}`}>
        <Tooltip content={t("git.statusbar.changes")}>
          <span className="git-status-bar__item">
            <Diff size={13} aria-hidden="true" />
            <span className="git-status-bar__value">{changeCount}</span>
          </span>
        </Tooltip>
        <Tooltip content={t("git.statusbar.ahead")}>
          <button
            className="git-status-bar__item git-status-bar__item--actionable git-status-bar__item--ahead"
            type="button"
            aria-label={t("action.push")}
            disabled={ahead <= 0}
            onClick={() => openConfirm("push", ahead)}
          >
            <ArrowUpFromLine size={13} aria-hidden="true" />
            <span className="git-status-bar__value">{ahead}</span>
          </button>
        </Tooltip>
        <Tooltip content={t("git.statusbar.behind")}>
          <button
            className="git-status-bar__item git-status-bar__item--actionable git-status-bar__item--behind"
            type="button"
            aria-label={t("action.pull")}
            disabled={behind <= 0}
            onClick={() => openConfirm("pull", behind)}
          >
            <ArrowDownToLine size={13} aria-hidden="true" />
            <span className="git-status-bar__value">{behind}</span>
          </button>
        </Tooltip>
        <Tooltip content={fetchTitle}>
          <button
            className="git-status-bar__item git-status-bar__item--actionable"
            type="button"
            aria-label={fetchAriaLabel}
            disabled={isFetching}
            onClick={() => void refreshAfterFetch()}
          >
            <RefreshCw size={13} aria-hidden="true" className={isFetching ? "spin" : undefined} />
          </button>
        </Tooltip>
      </div>

      <Modal
        className="git-status-bar__confirm"
        dismissible={!isDialogLocked}
        open={isDialogOpen}
        onOpenChange={handleOpenChange}
      >
        <ModalHeader>
          <ModalTitle>
            <AlertTriangle size={16} />
            <span>
              {authPrompt
                ? dialogIntent === "push"
                  ? t("git.push_confirm_title")
                  : dialogIntent === "pull"
                    ? t("git.pull_confirm_title")
                    : t("git.fetch_label")
                : confirmTitle}
            </span>
          </ModalTitle>
          <IconButton
            aria-label={t("action.close")}
            disabled={isDialogLocked}
            icon={<X size={14} />}
            onClick={closeConfirm}
            size="sm"
          />
        </ModalHeader>

        <ModalBody>
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
                <label htmlFor={`git-auth-username-${workspaceId}`}>{t("git.auth_username")}</label>
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
                <label htmlFor={`git-auth-password-${workspaceId}`}>{t("git.auth_password")}</label>
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
        </ModalBody>

        <ModalFooter>
          <Button onClick={closeConfirm} disabled={isDialogLocked}>
            {t("action.cancel")}
          </Button>
          {authPrompt ? (
            <Button
              variant="primary"
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
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void confirmSync()}
              disabled={isSyncingCurrentAction}
            >
              {isSyncingCurrentAction ? confirmActionBusyLabel : confirmActionLabel}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
};

export default GitStatusBar;
