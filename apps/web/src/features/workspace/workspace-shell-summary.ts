import type { Translator } from "../../i18n";
import type { ExecTarget, Session } from "../../state/workbench-core";

export type WorkspaceShellSummaryItem = {
  key: "branch" | "runtime" | "changes" | "queue";
  label: string;
  value: string;
  tone?: "neutral" | "info" | "active" | "queue";
};

const formatRuntimeLabel = (target: ExecTarget | undefined, t: Translator) => {
  if (target?.type === "wsl") {
    return target.distro?.trim() ? `WSL (${target.distro.trim()})` : "WSL";
  }

  return t("nativeLabel");
};

const countQueuedWork = (sessions: Array<Pick<Session, "status" | "queue">>) =>
  sessions.reduce((total, session) => {
    return total + session.queue.filter((task) => task.status === "queued").length;
  }, 0);

export const buildWorkspaceShellSummary = ({
  branchName,
  changeCount,
  target,
  sessions,
  t,
}: {
  branchName: string;
  changeCount: number;
  target: ExecTarget | undefined;
  sessions: Array<Pick<Session, "status" | "queue">>;
  t: Translator;
}): WorkspaceShellSummaryItem[] => {
  const queueCount = countQueuedWork(sessions);

  return [
    { key: "branch", label: t("branch"), value: branchName || "—" },
    {
      key: "runtime",
      label: t("runtimeLabel"),
      value: formatRuntimeLabel(target, t),
      tone: "info",
    },
    {
      key: "changes",
      label: t("changes"),
      value: String(changeCount),
      tone: changeCount > 0 ? "active" : "neutral",
    },
    {
      key: "queue",
      label: t("queueLabel"),
      value: String(queueCount),
      tone: queueCount > 0 ? "queue" : "neutral",
    },
  ];
};
