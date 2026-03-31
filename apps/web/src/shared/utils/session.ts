import { createTranslator, formatSessionReadyMessage, formatSessionTitle, type Locale } from "../../i18n.ts";
import { createId, type Session, type SessionMode, type SessionStatus, type Tab } from "../../state/workbench-core.ts";
import type { BackendSession } from "../../types/app.ts";

export const nowLabel = () => new Date().toLocaleTimeString().slice(0, 5);

export const parseNumericId = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractGeneratedSessionTitleIndex = (value: string) => {
  const match = value.trim().match(/^(?:Session|会话) (\d+)$/);
  return match?.[1] ? Number(match[1]) : null;
};

export const isGeneratedSessionTitleForId = (value: string | undefined, id: string | number) => {
  if (!value) return false;
  const index = extractGeneratedSessionTitleIndex(value);
  const numericId = typeof id === "number" ? id : parseNumericId(id);
  return index !== null && numericId !== null && index === numericId;
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
  stream: source.stream ?? existing?.stream ?? "",
  unread: source.unread ?? existing?.unread ?? 0,
  lastActiveAt: source.last_active_at,
  resumeId: source.resume_id ?? existing?.resumeId
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
    stream: existing?.stream ?? "",
    unread: existing?.unread ?? 0,
    lastActiveAt: existing?.lastActiveAt ?? Date.now(),
    resumeId: existing?.resumeId,
  };
};

export const isDraftSession = (session: Session | undefined | null) => Boolean(session?.isDraft);

export const isHiddenDraftPlaceholder = (session: Session | undefined | null) => Boolean(
  session
  && !session.stream.trim()
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

const isForegroundActiveStatus = (status: SessionStatus) => status === "running" || status === "waiting";
export { isForegroundActiveStatus };

// `background` is treated as a display-only compatibility status for older persisted data.
// New state updates keep the underlying runtime status (`running` / `waiting`) intact.
export const toBackgroundStatus = (status: SessionStatus): SessionStatus => status;

export const restoreVisibleStatus = (session: Session): SessionStatus => {
  if (session.status !== "background") return session.status;
  return "waiting";
};

export const resolveVisibleStatus = (_tab: Tab, _session: Session, nextStatus: SessionStatus): SessionStatus => {
  return nextStatus;
};

export const displaySessionStatus = (tab: Pick<Tab, "activeSessionId">, session: Session): SessionStatus => {
  if (session.status === "background") return "background";
  if (session.id !== tab.activeSessionId && isForegroundActiveStatus(session.status)) {
    return "background";
  }
  return session.status;
};

export const sessionTone = (status: SessionStatus) => {
  if (status === "running" || status === "waiting" || status === "background") return "active";
  if (status === "idle") return "idle";
  if (status === "queued") return "queued";
  return "suspended";
};

export const sessionHeaderTag = (
  status: SessionStatus,
  locale: Locale,
): {
  label: string;
  tone: "active" | "info" | "queue" | "idle" | "muted";
} => {
  const t = createTranslator(locale);

  if (status === "running") {
    return { label: t("running"), tone: "active" };
  }
  if (status === "background") {
    return { label: t("background"), tone: "info" };
  }
  if (status === "waiting") {
    return { label: t("waiting"), tone: "active" };
  }
  if (status === "queued") {
    return { label: t("queued"), tone: "queue" };
  }
  if (status === "idle") {
    return { label: t("ready"), tone: "idle" };
  }

  return { label: t("suspended"), tone: "muted" };
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
