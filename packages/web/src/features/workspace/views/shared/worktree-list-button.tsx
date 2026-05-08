import type { WorktreeInfo } from "@coder-studio/core";
import { useAtom, useAtomValue } from "jotai";
import { GitFork, X } from "lucide-react";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms";
import { useTranslation } from "../../../../lib/i18n";
import { worktreeListAtomFamily } from "../../atoms";
import { WorktreeModal } from "./worktree-modal";

interface WorktreeListButtonProps {
  workspaceId: string;
}

export const WorktreeListButton: FC<WorktreeListButtonProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [list, setList] = useAtom(worktreeListAtomFamily(workspaceId));
  const [showList, setShowList] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const inFlightWorkspaceRef = useRef<string | null>(null);

  const selected = useMemo(
    () => list.items.find((item) => item.path === selectedPath) ?? null,
    [list.items, selectedPath]
  );

  const loadWorktrees = () => {
    if (inFlightWorkspaceRef.current === workspaceId) {
      return;
    }

    inFlightWorkspaceRef.current = workspaceId;
    setList((prev) => ({ ...prev, loading: true, error: undefined }));
    void dispatch<{ worktrees: WorktreeInfo[] }>("worktree.list", { workspaceId })
      .then((result) => {
        if (result.ok && result.data && Array.isArray(result.data.worktrees)) {
          setList({
            items: result.data.worktrees,
            loading: false,
            lastLoadedAt: Date.now(),
          });
          return;
        }
        setList((prev) => ({
          ...prev,
          loading: false,
          error: result.error?.message ?? prev.error,
        }));
      })
      .catch((err) => {
        setList((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      })
      .finally(() => {
        if (inFlightWorkspaceRef.current === workspaceId) {
          inFlightWorkspaceRef.current = null;
        }
      });
  };

  useEffect(() => {
    if (list.lastLoadedAt || list.error) return;
    loadWorktrees();
  }, [workspaceId, dispatch, list.lastLoadedAt, setList]);

  useEffect(() => {
    setSelectedPath(null);
  }, [workspaceId]);

  const count = list.items.length;

  return (
    <>
      <button
        type="button"
        className="git-status-bar__item git-status-bar__item--actionable"
        title={t("worktree.list_title")}
        aria-label={t("worktree.list_open_label")}
        onClick={() => {
          if ((!list.lastLoadedAt || list.error) && !list.loading) {
            loadWorktrees();
          }
          setShowList(true);
        }}
        disabled={list.loading && count === 0}
      >
        <GitFork size={13} aria-hidden="true" />
        <span className="git-status-bar__value">{count}</span>
      </button>

      {showList ? (
        <div className="modal-overlay" onClick={() => setShowList(false)}>
          <div
            className="modal-card worktree-list-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{t("worktree.list_title")}</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowList(false)}
                aria-label={t("action.close")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              {list.error ? (
                <div className="worktree-error">
                  {t("worktree.list_error", { error: list.error })}
                </div>
              ) : list.loading && count === 0 ? (
                <div className="worktree-loading">{t("worktree.loading")}</div>
              ) : count === 0 ? (
                <div className="worktree-empty">{t("worktree.list_empty")}</div>
              ) : (
                <ul className="worktree-list">
                  {list.items.map((item) => (
                    <li key={item.path} className="worktree-list-row">
                      <button
                        type="button"
                        className="worktree-list-row__button"
                        onClick={() => {
                          setSelectedPath(item.path);
                          setShowList(false);
                        }}
                      >
                        <span className="worktree-list-row__name">{item.name}</span>
                        <span className="worktree-list-row__branch">🌿 {item.branch}</span>
                        <span
                          className={`worktree-chip worktree-chip-status ${
                            item.status === "clean" ? "worktree-clean" : "worktree-dirty"
                          }`}
                        >
                          {item.status === "clean"
                            ? t("worktree.clean")
                            : t("worktree.dirty_status")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <WorktreeModal
        workspaceId={workspaceId}
        worktree={selected}
        onClose={() => setSelectedPath(null)}
      />
    </>
  );
};

export default WorktreeListButton;
