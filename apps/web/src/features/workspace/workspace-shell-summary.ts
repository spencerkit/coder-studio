import type { Locale } from "../../i18n";
import type { ExecTarget, Session } from "../../state/workbench-core";

export type WorkspaceShellSummaryItem = {
  key: "branch" | "runtime" | "changes" | "queue";
  label: string;
  value: string;
  tone?: "neutral" | "info" | "active" | "queue";
};

const formatRuntimeLabel = (target: ExecTarget | undefined, locale: Locale) => {
  if (target?.type === "wsl") {
    return target.distro?.trim() ? `WSL (${target.distro.trim()})` : "WSL";
  }

  return locale === "zh" ? "本机" : "Native";
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
  locale,
}: {
  branchName: string;
  changeCount: number;
  target: ExecTarget | undefined;
  sessions: Array<Pick<Session, "status" | "queue">>;
  locale: Locale;
}): WorkspaceShellSummaryItem[] => {
  const queueCount = countQueuedWork(sessions);

  return [
    { key: "branch", label: locale === "zh" ? "分支" : "Branch", value: branchName || "—" },
    {
      key: "runtime",
      label: locale === "zh" ? "运行时" : "Runtime",
      value: formatRuntimeLabel(target, locale),
      tone: "info",
    },
    {
      key: "changes",
      label: locale === "zh" ? "改动" : "Changes",
      value: String(changeCount),
      tone: changeCount > 0 ? "active" : "neutral",
    },
    {
      key: "queue",
      label: locale === "zh" ? "队列" : "Queue",
      value: String(queueCount),
      tone: queueCount > 0 ? "queue" : "neutral",
    },
  ];
};
