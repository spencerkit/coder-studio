import {
  isActionableWorkspaceMemoryType,
  WORKSPACE_MEMORY_STATUSES,
  WORKSPACE_MEMORY_TYPES,
  type WorkspaceMemoryEntry,
  WorkspaceMemoryStatus,
  type WorkspaceMemoryStatus as WorkspaceMemoryStatusType,
  WorkspaceMemoryType,
  type WorkspaceMemoryType as WorkspaceMemoryTypeType,
} from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { Pencil, Trash2, X } from "lucide-react";
import { type FC, useEffect, useId, useMemo, useState } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import { Button } from "../../../../components/ui/button";
import { ConfirmDialog } from "../../../../components/ui/confirm-dialog";
import { IconButton } from "../../../../components/ui/icon-button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../../../../components/ui/modal";
import { Select, type SelectOption } from "../../../../components/ui/select";
import { formatRelativeTime, useTranslation } from "../../../../lib/i18n";
import { useMemoryPanel } from "../../actions/use-memory-panel";

interface MemoryPanelProps {
  workspaceId: string;
  refreshToken?: number;
}

interface MemoryDraft {
  content: string;
  type: WorkspaceMemoryTypeType;
  status?: WorkspaceMemoryStatusType;
}

const DEFAULT_MEMORY_TYPE: WorkspaceMemoryTypeType = WorkspaceMemoryType.Wiki;

const EMPTY_DRAFT: MemoryDraft = {
  content: "",
  type: DEFAULT_MEMORY_TYPE,
};

function formatMemoryType(
  type: WorkspaceMemoryTypeType,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  return t(`workspace.memory.types.${type}`);
}

function entryMatchesQuery(entry: WorkspaceMemoryEntry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }

  return [entry.content, entry.type].some((value) => value.toLowerCase().includes(trimmed));
}

function previewContent(content: string): string {
  const normalized = content.trim().replace(/\s+/gu, " ");
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function memoryLabel(entry: WorkspaceMemoryEntry): string {
  return previewContent(entry.content);
}

function formatMemoryTypeBadge(
  type: WorkspaceMemoryTypeType,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  return formatMemoryType(type, t).toLowerCase();
}

function formatMemoryStatus(
  status: WorkspaceMemoryStatusType,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  return t(`workspace.memory.statuses.${status}`);
}

function draftFromEntry(entry: WorkspaceMemoryEntry): MemoryDraft {
  const status = normalizeDraftStatus(entry.type, entry.status);

  return {
    content: entry.content,
    type: entry.type,
    ...(status ? { status } : {}),
  };
}

function createDefaultDraft(type: WorkspaceMemoryTypeType = DEFAULT_MEMORY_TYPE): MemoryDraft {
  return {
    content: "",
    type,
    ...(isActionableWorkspaceMemoryType(type) ? { status: WorkspaceMemoryStatus.NotStarted } : {}),
  };
}

function normalizeDraftStatus(type: WorkspaceMemoryTypeType, status?: WorkspaceMemoryStatusType) {
  if (!isActionableWorkspaceMemoryType(type)) {
    return undefined;
  }

  return status ?? WorkspaceMemoryStatus.NotStarted;
}

function formatActiveCount(
  count: number,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  return t(count === 1 ? "workspace.memory.active_count_one" : "workspace.memory.active_count", {
    count,
  });
}

export const MemoryPanel: FC<MemoryPanelProps> = ({ workspaceId, refreshToken = 0 }) => {
  const t = useTranslation();
  const memoryTypeLabelId = useId();
  const locale = useAtomValue(localeAtom) === "zh" ? "zh" : "en";
  const memoryTypeOptions: ReadonlyArray<SelectOption<WorkspaceMemoryTypeType>> =
    WORKSPACE_MEMORY_TYPES.map((type) => ({
      value: type,
      label: formatMemoryType(type, t),
    }));
  const statusOptions: ReadonlyArray<SelectOption<WorkspaceMemoryStatusType>> =
    WORKSPACE_MEMORY_STATUSES.map((status) => ({
      value: status,
      label: formatMemoryStatus(status, t),
    }));
  const {
    createMemory,
    deleteMemory,
    entries,
    errorMessage,
    loading,
    refreshMemory,
    saving,
    updateMemory,
  } = useMemoryPanel(workspaceId);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<WorkspaceMemoryTypeType | "all">("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WorkspaceMemoryEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(typeof entries)[number] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<MemoryDraft>(EMPTY_DRAFT);
  const filteredEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (typeFilter === "all" || entry.type === typeFilter) && entryMatchesQuery(entry, query)
      ),
    [entries, query, typeFilter]
  );

  useEffect(() => {
    void refreshMemory();
  }, [refreshMemory, refreshToken]);

  useEffect(() => {
    const firstEntry = entries[0] ?? null;

    if (selectedId === null && firstEntry) {
      setSelectedId(firstEntry.id);
      return;
    }

    if (selectedId !== null && !entries.some((entry) => entry.id === selectedId)) {
      setSelectedId(firstEntry?.id ?? null);
    }
  }, [entries, selectedId]);

  const startNewMemory = () => {
    setEditingEntry(null);
    setCreateDraft(createDefaultDraft());
    setCreateDialogOpen(true);
  };

  const closeEditor = () => {
    setCreateDialogOpen(false);
    setEditingEntry(null);
    setCreateDraft(EMPTY_DRAFT);
  };

  const startEditMemory = (entry: WorkspaceMemoryEntry) => {
    setEditingEntry(entry);
    setCreateDraft(draftFromEntry(entry));
    setCreateDialogOpen(true);
  };

  const saveMemory = async () => {
    const payload = {
      content: createDraft.content,
      type: createDraft.type,
      ...(createDraft.status ? { status: createDraft.status } : {}),
    };
    const saved = editingEntry
      ? await updateMemory({
          id: editingEntry.id,
          ...payload,
        })
      : await createMemory(payload);

    if (saved) {
      closeEditor();
      setSelectedId(saved.id);
    }
  };

  const confirmDeleteMemory = async () => {
    if (!pendingDelete) {
      return;
    }

    const deleted = await deleteMemory(pendingDelete.id);

    if (deleted) {
      setPendingDelete(null);
    }
  };

  const renderMemoryForm = (
    formDraft: MemoryDraft,
    setFormDraft: (updater: (current: MemoryDraft) => MemoryDraft) => void
  ) => {
    const actionableType = isActionableWorkspaceMemoryType(formDraft.type);

    return (
      <div className="memory-panel__form">
        <div className="memory-panel__field">
          <span id={memoryTypeLabelId} className="memory-panel__label">
            {t("workspace.memory.type_label")}
          </span>
          <Select
            desktopMode="listbox"
            className="workspace-sidebar-control memory-panel__select"
            mobileSheetPresentation="inline"
            mobileSheetTitle={t("workspace.memory.type_label")}
            options={memoryTypeOptions}
            value={formDraft.type}
            aria-labelledby={memoryTypeLabelId}
            onValueChange={(value) =>
              setFormDraft((current) => ({
                ...current,
                type: value,
                status: normalizeDraftStatus(value, current.status),
              }))
            }
          />
        </div>

        {actionableType ? (
          <div className="memory-panel__field">
            <span className="memory-panel__label">{t("workspace.memory.status_label")}</span>
            <Select
              desktopMode="listbox"
              className="workspace-sidebar-control memory-panel__select"
              mobileSheetPresentation="inline"
              mobileSheetTitle={t("workspace.memory.status_label")}
              options={statusOptions}
              value={formDraft.status ?? WorkspaceMemoryStatus.NotStarted}
              aria-label={t("workspace.memory.status_label")}
              onValueChange={(value) =>
                setFormDraft((current) => ({
                  ...current,
                  status: value,
                }))
              }
            />
          </div>
        ) : null}

        <label className="memory-panel__field">
          <span className="memory-panel__label">{t("workspace.memory.content_label")}</span>
          <textarea
            className="workspace-sidebar-control memory-panel__textarea"
            value={formDraft.content}
            onChange={(event) =>
              setFormDraft((current) => ({ ...current, content: event.target.value }))
            }
            aria-label={t("workspace.memory.content_label")}
          />
        </label>
      </div>
    );
  };

  return (
    <>
      <div className="workspace-sidebar-view memory-panel">
        <div className="workspace-sidebar-panel__body memory-panel__body">
          <section className="memory-panel__head">
            <div className="memory-panel__head-row">
              <div className="memory-panel__head-copy">
                <p className="memory-panel__eyebrow">{t("workspace.memory.project_title")}</p>
                <h2 className="memory-panel__sr-title">{t("workspace.memory.title")}</h2>
                <p className="memory-panel__count">{formatActiveCount(entries.length, t)}</p>
              </div>
              <button
                type="button"
                className="workspace-sidebar-section__action memory-panel__button memory-panel__button--primary memory-panel__new"
                onClick={startNewMemory}
              >
                {t("workspace.memory.new")}
              </button>
            </div>

            {errorMessage ? (
              <p className="memory-panel__notice" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <label className="memory-panel__search">
              <span className="memory-panel__sr-title">{t("workspace.memory.search")}</span>
              <input
                type="search"
                className="workspace-sidebar-control memory-panel__input"
                aria-label={t("workspace.memory.search")}
                placeholder={t("workspace.memory.search_placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div
              className="memory-panel__chips"
              role="group"
              aria-label={t("workspace.memory.type_filter")}
            >
              <button
                type="button"
                className={`memory-panel__chip${
                  typeFilter === "all" ? " memory-panel__chip--active" : ""
                }`}
                aria-pressed={typeFilter === "all"}
                onClick={() => setTypeFilter("all")}
              >
                {t("common.all")}
              </button>
              {WORKSPACE_MEMORY_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`memory-panel__chip${
                    typeFilter === type ? " memory-panel__chip--active" : ""
                  }`}
                  aria-pressed={typeFilter === type}
                  onClick={() => setTypeFilter(type)}
                >
                  {formatMemoryType(type, t)}
                </button>
              ))}
            </div>
          </section>

          <section className="memory-panel__list-section">
            <ul className="memory-panel__list" aria-label={t("workspace.memory.entries")}>
              {filteredEntries.map((entry) => {
                const isActive = entry.id === selectedId;
                const label = memoryLabel(entry);
                const editLabel = t("workspace.memory.edit_entry", { label });
                const deleteLabel = t("workspace.memory.delete_entry", { label });

                return (
                  <li key={entry.id} className="memory-panel__list-row">
                    <div
                      className={`memory-panel__card${isActive ? " memory-panel__card--active" : ""}`}
                    >
                      <button
                        type="button"
                        className="memory-panel__item"
                        aria-current={isActive ? "true" : undefined}
                        aria-label={`${label} ${formatMemoryType(entry.type, t)}`}
                        onClick={() => {
                          setSelectedId(entry.id);
                        }}
                      >
                        <span className="memory-panel__item-content">
                          {previewContent(entry.content)}
                        </span>
                      </button>
                      <div className="memory-panel__item-meta">
                        <span className="memory-panel__item-meta-main">
                          <span className="memory-panel__item-badges">
                            <span
                              className={`memory-panel__badge memory-panel__badge--${entry.type}`}
                            >
                              {formatMemoryTypeBadge(entry.type, t)}
                            </span>
                            {entry.status ? (
                              <span
                                className={`memory-panel__badge memory-panel__badge--status memory-panel__badge--status-${entry.status}`}
                              >
                                {formatMemoryStatus(entry.status, t).toLowerCase()}
                              </span>
                            ) : null}
                          </span>
                          <span>{formatRelativeTime(entry.updatedAt, locale)}</span>
                        </span>
                        <span className="memory-panel__item-meta-actions">
                          <IconButton
                            aria-label={editLabel}
                            className="memory-panel__item-action memory-panel__item-edit"
                            disabled={saving}
                            icon={<Pencil size={13} />}
                            onClick={() => {
                              startEditMemory(entry);
                            }}
                            size="sm"
                            title={editLabel}
                            variant="ghost"
                          />
                          <IconButton
                            aria-label={deleteLabel}
                            className="memory-panel__item-action memory-panel__item-delete"
                            disabled={saving}
                            icon={<Trash2 size={13} />}
                            onClick={() => {
                              setPendingDelete(entry);
                            }}
                            size="sm"
                            title={deleteLabel}
                            variant="ghost"
                          />
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}

              {!loading && filteredEntries.length === 0 ? (
                <p className="memory-panel__empty">{t("workspace.memory.empty")}</p>
              ) : null}
              {loading ? (
                <p className="memory-panel__empty">{t("workspace.memory.loading")}</p>
              ) : null}
            </ul>
          </section>
        </div>
      </div>
      <Modal
        className="memory-panel__create-modal"
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            setEditingEntry(null);
            setCreateDraft(EMPTY_DRAFT);
          }
        }}
        open={createDialogOpen}
        size="sm"
      >
        <ModalHeader>
          <ModalTitle>
            {editingEntry ? t("workspace.memory.edit") : t("workspace.memory.create")}
          </ModalTitle>
          <IconButton
            aria-label={t("common.close")}
            icon={<X size={14} />}
            onClick={() => {
              closeEditor();
            }}
            size="sm"
          />
        </ModalHeader>
        <ModalBody>{renderMemoryForm(createDraft, setCreateDraft)}</ModalBody>
        <ModalFooter>
          <Button onClick={closeEditor}>{t("common.cancel")}</Button>
          <Button loading={saving} onClick={() => void saveMemory()} variant="primary">
            {t("workspace.memory.save")}
          </Button>
        </ModalFooter>
      </Modal>
      <ConfirmDialog
        cancelText={t("common.cancel")}
        closeLabel={t("common.close")}
        confirmText={t("workspace.memory.delete")}
        description={
          pendingDelete
            ? t("workspace.memory.delete_confirm_description", {
                label: memoryLabel(pendingDelete),
              })
            : undefined
        }
        confirmDisabled={saving}
        onConfirm={() => void confirmDeleteMemory()}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        open={pendingDelete !== null}
        title={t("workspace.memory.delete_confirm_title")}
        tone="danger"
      />
    </>
  );
};
