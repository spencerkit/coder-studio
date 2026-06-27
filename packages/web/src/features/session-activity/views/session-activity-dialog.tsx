import type {
  Session,
  SessionActivityEntry,
  SessionActivityKind,
  SessionActivityPhase,
  SessionActivityStatus,
} from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { localeAtom } from "../../../atoms/app-ui";
import {
  Button,
  DialogHeader,
  EmptyState,
  IconButton,
  Modal,
  ModalBody,
  ModalTitle,
  SegmentedControl,
  Tag,
} from "../../../components/ui";
import { formatDate } from "../../../lib/i18n";
import { formatProviderLabel } from "../../notifications/format";
import { useSessionActivity } from "../actions/use-session-activity";

interface SessionActivityDialogProps {
  sessionId: string;
  workspaceId: string;
}

const FILTER_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Plans", value: "plan" },
  { label: "Commands", value: "command" },
  { label: "Edits", value: "edit" },
  { label: "Reviews", value: "review" },
] as const;

const KIND_TAG_COLOR: Record<
  SessionActivityKind,
  "blue" | "green" | "amber" | "purple" | "neutral"
> = {
  plan: "blue",
  command: "green",
  edit: "purple",
  review: "amber",
  note: "neutral",
};

const STATUS_TAG_COLOR: Record<
  NonNullable<SessionActivityStatus>,
  "blue" | "green" | "amber" | "pink"
> = {
  info: "blue",
  success: "green",
  warning: "amber",
  error: "pink",
};

function formatSessionStateLabel(state: Session["state"] | undefined): string {
  if (!state) {
    return "Unknown";
  }

  return state.charAt(0).toUpperCase() + state.slice(1);
}

function formatPhaseLabel(phase?: SessionActivityPhase): string | null {
  if (!phase) {
    return null;
  }

  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function formatKindLabel(kind: SessionActivityKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function SessionActivityEntryCard({
  entry,
  locale,
}: {
  entry: SessionActivityEntry;
  locale: "en" | "zh";
}) {
  const formattedPayload =
    entry.payload && Object.keys(entry.payload).length > 0
      ? JSON.stringify(entry.payload, null, 2)
      : null;

  return (
    <article
      style={{
        border: "1px solid var(--color-border-subtle, rgba(128, 128, 128, 0.24))",
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 8,
        background: "var(--color-surface-elevated, rgba(255, 255, 255, 0.02))",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Tag color={KIND_TAG_COLOR[entry.kind]} size="sm" caps={false}>
            {formatKindLabel(entry.kind)}
          </Tag>
          {entry.phase ? (
            <Tag color="neutral" size="sm" caps={false}>
              {formatPhaseLabel(entry.phase)}
            </Tag>
          ) : null}
          {entry.status ? (
            <Tag color={STATUS_TAG_COLOR[entry.status]} size="sm" caps={false}>
              {entry.status}
            </Tag>
          ) : null}
        </div>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{formatDate(entry.createdAt, locale)}</span>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <strong>{entry.title}</strong>
        {entry.summary ? <p style={{ margin: 0, opacity: 0.85 }}>{entry.summary}</p> : null}
      </div>

      {entry.command ? (
        <pre
          style={{
            margin: 0,
            padding: 10,
            borderRadius: 10,
            background: "var(--color-surface-3, rgba(0, 0, 0, 0.18))",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {entry.command}
        </pre>
      ) : null}

      {entry.files?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {entry.files.map((file) => (
            <Tag key={file} color="neutral" size="sm" caps={false}>
              {file}
            </Tag>
          ))}
        </div>
      ) : null}

      {formattedPayload ? (
        <pre
          style={{
            margin: 0,
            padding: 10,
            borderRadius: 10,
            background: "var(--color-surface-3, rgba(0, 0, 0, 0.18))",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {formattedPayload}
        </pre>
      ) : null}
    </article>
  );
}

export function SessionActivityDialog({ sessionId, workspaceId }: SessionActivityDialogProps) {
  const locale = useAtomValue(localeAtom);
  const { entries, errorMessage, filter, loading, open, session, setFilter, setOpen } =
    useSessionActivity(sessionId, workspaceId);

  if (!open) {
    return null;
  }

  return (
    <Modal onOpenChange={setOpen} open size="lg">
      <DialogHeader>
        <div className="dialog-header__leading">
          <div className="dialog-header__copy">
            <ModalTitle>Session Logs</ModalTitle>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <Tag color="neutral" size="sm" caps={false}>
                {session?.title?.trim() || sessionId}
              </Tag>
              <Tag color="blue" size="sm" caps={false}>
                {formatProviderLabel(session?.providerId ?? "")}
              </Tag>
              <Tag color="neutral" size="sm" caps={false}>
                {formatSessionStateLabel(session?.state)}
              </Tag>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="sm" variant="ghost" onClick={() => void 0}>
            Current session
          </Button>
          <IconButton
            aria-label="Close"
            className="modal-close"
            icon={<X size={14} />}
            onClick={() => setOpen(false)}
            size="sm"
          />
        </div>
      </DialogHeader>

      <ModalBody>
        <div style={{ display: "grid", gap: 16 }}>
          <SegmentedControl
            options={FILTER_OPTIONS}
            size="sm"
            value={filter}
            onChange={(value) => {
              setFilter(value as "all" | "plan" | "command" | "edit" | "review");
            }}
          />

          {loading ? (
            <EmptyState title={<p>Loading session logs</p>} description={<p>Please wait...</p>} />
          ) : null}

          {!loading && errorMessage ? (
            <EmptyState
              title={<p>Unable to load session logs</p>}
              description={<p>{errorMessage}</p>}
            />
          ) : null}

          {!loading && !errorMessage && entries.length === 0 ? (
            <EmptyState
              title={<p>No session logs</p>}
              description={<p>No logs recorded for this session yet.</p>}
            />
          ) : null}

          {!loading && !errorMessage && entries.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              {entries.map((entry) => (
                <SessionActivityEntryCard
                  key={entry.id}
                  entry={entry}
                  locale={locale === "zh" ? "zh" : "en"}
                />
              ))}
            </div>
          ) : null}
        </div>
      </ModalBody>
    </Modal>
  );
}
