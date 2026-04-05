import { createTranslator, formatSessionReadyMessage, formatSessionTitle, type Locale } from "../../i18n";
import { createId, type Session, type SessionMode, type SessionStatus } from "../../state/workbench-core";
import type { BackendSession } from "../../types/app";

export const nowLabel = () => new Date().toLocaleTimeString().slice(0, 5);

export const parseNumericId = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isGeneratedSessionTitleForId = (value: string | undefined, id: string | number) => {
  if (!value) return false;
  const sessionId = String(id).trim();
  const normalized = value.trim();
  if (normalized === `Session ${sessionId}` || normalized === `会话 ${sessionId}`) {
    return true;
  }
  const numericId = typeof id === "number" ? id : parseNumericId(sessionId);
  if (numericId === null) return false;
  return normalized === `Session ${String(numericId).padStart(2, "0")}`
    || normalized === `会话 ${String(numericId).padStart(2, "0")}`;
};

export const createSessionFromBackend = (source: BackendSession, locale: Locale, existing?: Session): Session => ({
  id: String(source.id),
  title: (
    source.title
      && existing?.title
      && isGeneratedSessionTitleForId(source.title, source.id)
      && !isGeneratedSessionTitleForId(existing.title, source.id)
  )
    ? existing.title
    : (source.title || existing?.title || formatSessionTitle(source.id, locale)),
  status: source.status,
  mode: source.mode,
  provider: source.provider,
  autoFeed: source.auto_feed,
  isDraft: false,
  queue: source.queue.map((task) => ({
    id: String(task.id),
    text: task.text,
    status: task.status
  })),
  messages: source.messages?.length
    ? source.messages
    : (existing?.messages ?? [
      {
        id: createId("msg"),
        role: "system",
        content: formatSessionReadyMessage(source.id, locale),
        time: nowLabel()
      }
  ]),
  terminalId: existing?.terminalId,
  unread: source.unread ?? existing?.unread ?? 0,
  lastActiveAt: source.last_active_at,
  resumeId: source.resume_id ?? existing?.resumeId,
  unavailableReason: source.unavailable_reason ?? existing?.unavailableReason,
});

type CreateDraftSessionArgs = {
  locale: Locale;
  workspacePath: string;
  branch?: string;
  mode?: SessionMode;
  provider?: Session["provider"];
  existing?: Session;
};

export const createDraftSessionPlaceholder = ({
  locale,
  workspacePath,
  branch,
  mode = "branch",
  provider,
  existing,
}: CreateDraftSessionArgs): Session => {
  const t = createTranslator(locale);
  const branchSuffix = branch && branch !== "—" ? ` · ${branch}` : "";
  const workspaceLabel = `${workspacePath}${branchSuffix}`;
  return {
    id: existing?.id ?? createId("session"),
    title: existing?.title ?? t("draftSessionTitle"),
    status: existing?.status ?? "idle",
    mode: existing?.mode ?? mode,
    provider: existing?.provider ?? provider ?? "claude",
    autoFeed: existing?.autoFeed ?? true,
    isDraft: true,
    queue: existing?.queue ?? [],
    messages: existing?.messages?.length
      ? existing.messages
      : [
          {
            id: createId("msg"),
            role: "system",
            content: t("draftSessionPrompt"),
            time: nowLabel(),
          },
          {
            id: createId("msg"),
            role: "system",
            content: t("draftSessionWorkspace", { path: workspaceLabel }),
            time: nowLabel(),
          },
        ],
    terminalId: existing?.terminalId,
    unread: existing?.unread ?? 0,
    lastActiveAt: existing?.lastActiveAt ?? Date.now(),
    resumeId: existing?.resumeId,
    unavailableReason: existing?.unavailableReason,
  };
};

export const isDraftSession = (session: Session | undefined | null) => Boolean(session?.isDraft);

export const isHiddenDraftPlaceholder = (session: Session | undefined | null) => Boolean(
  session
  && session.queue.length === 0
  && session.messages.every((message) => message.role === "system")
);

export const sessionTitleFromInput = (value: string) => {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? value.trim();
  if (!firstLine) return "";
  if (firstLine.length <= 48) return firstLine;
  return `${firstLine.slice(0, 45)}...`;
};

export type SessionDisplayStatus = SessionStatus | "archived";

const isForegroundActiveStatus = (status: SessionStatus) => status === "running";
export { isForegroundActiveStatus };

export const displaySessionStatus = (session: Session): SessionStatus => session.status;

export const sessionTone = (status: SessionDisplayStatus) => {
  if (status === "running") return "active";
  return "idle";
};

export const sessionHeaderTag = (
  status: SessionDisplayStatus,
  locale: Locale,
): {
  label: string;
  tone: "active" | "idle" | "muted";
} => {
  const t = createTranslator(locale);

  if (status === "running") {
    return { label: t("running"), tone: "active" };
  }
  if (status === "idle") {
    return { label: t("ready"), tone: "idle" };
  }
  if (status === "archived") {
    return { label: t("historyArchived"), tone: "muted" };
  }

  return { label: t("interrupted"), tone: "muted" };
};

export const formatRelativeSessionTime = (value: number, locale: Locale) => {
  const diffMs = value - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const rtf = new Intl.RelativeTimeFormat(locale === "zh" ? "zh-CN" : "en", { numeric: "auto" });

  if (absMs < hour) {
    return rtf.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return rtf.format(Math.round(diffMs / hour), "hour");
  }
  if (absMs < week) {
    return rtf.format(Math.round(diffMs / day), "day");
  }
  return rtf.format(Math.round(diffMs / week), "week");
};

export const sessionCompletionRatio = (session: Session) => {
  if (!session.queue.length) return 0;
  const complete = session.queue.filter((task) => task.status === "done").length;
  return Math.round((complete / session.queue.length) * 100);
};

export const modeLabel = (mode: SessionMode, locale: Locale) => (locale === "zh"
  ? (mode === "branch" ? "分支模式" : "工作树模式")
  : (mode === "branch" ? "Branch" : "Worktree"));
