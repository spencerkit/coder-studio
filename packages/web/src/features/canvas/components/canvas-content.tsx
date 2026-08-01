import type {
  CanvasAnchorCommentDocument,
  CanvasDataResponse,
  CanvasInspectionResponse,
  CanvasOverlayDocument,
  CanvasSceneElement,
  CanvasSceneManifest,
} from "@coder-studio/core";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../../lib/i18n";
import {
  fetchCanvasData,
  fetchCanvasInspectionData,
  saveCanvasAnchorComments,
  saveCanvasOverlay,
} from "../api";
import { ArchitectureCanvasRenderer } from "./architecture-canvas-renderer";
import { CanvasCommentLayer } from "./canvas-comment-layer";
import { CanvasOverlayLayer } from "./canvas-overlay-layer";
import { type CanvasContentLayout, CanvasRouteFrame } from "./canvas-route-frame";
import { createCanvasSceneRegistry } from "./canvas-scene-registry";
import { ReportCanvasRenderer } from "./report-canvas-renderer";

export type { CanvasContentLayout } from "./canvas-route-frame";
export type CanvasAnnotationTool = "inspect" | "select" | "pen" | "arrow" | "rect" | "text";
export type CanvasAnnotationCommandType = "delete-selected" | "clear-all";

export interface CanvasAnnotationCommand {
  id: number;
  type: CanvasAnnotationCommandType;
}

export interface CanvasContentExportState {
  exportRoot: HTMLElement | null;
  hasUnsavedCommentDraft: boolean;
  ready: boolean;
}

interface CanvasContentProps {
  workspaceId: string;
  sourcePath: string;
  refreshToken?: number;
  layout?: CanvasContentLayout;
  editable?: boolean;
  inspectionEnabled?: boolean;
  annotationTool?: CanvasAnnotationTool;
  annotationCommand?: CanvasAnnotationCommand | null;
  exportMode?: boolean;
  onExportStateChange?: (state: CanvasContentExportState) => void;
}

const EMPTY_SCENE_MANIFEST: CanvasSceneManifest = {
  version: 1,
  elements: [],
};

const EMPTY_ANCHOR_COMMENT_DOCUMENT: CanvasAnchorCommentDocument = {
  version: 1,
  comments: [],
};

function isInspectionResponse(
  data: CanvasDataResponse | CanvasInspectionResponse
): data is CanvasInspectionResponse {
  return "anchorCommentDocument" in data || "sceneManifest" in data || "inspectionImageUrl" in data;
}

function mergeSceneManifests(
  serverManifest: CanvasSceneManifest,
  localManifest: CanvasSceneManifest
): CanvasSceneManifest {
  const elements = new Map(
    serverManifest.elements.map((element) => [element.id, element] as const)
  );
  localManifest.elements.forEach((element) => {
    if (!elements.has(element.id)) {
      elements.set(element.id, element);
    }
  });

  return {
    version: 1,
    elements: [...elements.values()],
  };
}

export function CanvasContent({
  workspaceId,
  sourcePath,
  refreshToken = 0,
  layout = "page",
  editable = false,
  inspectionEnabled = false,
  annotationTool = "select",
  annotationCommand = null,
  exportMode = false,
  onExportStateChange,
}: CanvasContentProps) {
  const t = useTranslation();
  const [data, setData] = useState<CanvasDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sceneRegistry] = useState(() => createCanvasSceneRegistry());
  const [sceneManifest, setSceneManifest] = useState<CanvasSceneManifest>(EMPTY_SCENE_MANIFEST);
  const [inspectionSceneManifest, setInspectionSceneManifest] =
    useState<CanvasSceneManifest>(EMPTY_SCENE_MANIFEST);
  const [anchorCommentDocument, setAnchorCommentDocument] = useState<CanvasAnchorCommentDocument>(
    EMPTY_ANCHOR_COMMENT_DOCUMENT
  );
  const [selectedSceneElementId, setSelectedSceneElementId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [saveCommentError, setSaveCommentError] = useState<string | null>(null);
  const sceneRootRef = useRef<HTMLDivElement | null>(null);
  const effectiveSceneManifest = useMemo(
    () => mergeSceneManifests(inspectionSceneManifest, sceneManifest),
    [inspectionSceneManifest, sceneManifest]
  );
  const selectedSceneElement =
    selectedSceneElementId === null
      ? null
      : (effectiveSceneManifest.elements.find((element) => element.id === selectedSceneElementId) ??
        null);
  const inspectModeActive = inspectionEnabled && annotationTool === "inspect";

  useEffect(() => sceneRegistry.subscribe(setSceneManifest), [sceneRegistry]);

  useEffect(() => {
    const normalizedSourcePath = sourcePath.trim();
    if (!workspaceId || !normalizedSourcePath) {
      setData(null);
      setError("Canvas route is missing workspace or source path.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    sceneRegistry.clear();
    setData(null);
    setLoading(true);
    setError(null);
    setInspectionSceneManifest(EMPTY_SCENE_MANIFEST);
    setAnchorCommentDocument(EMPTY_ANCHOR_COMMENT_DOCUMENT);
    setSelectedSceneElementId(null);
    setCommentDraft("");
    setSaveCommentError(null);

    const request = inspectionEnabled
      ? fetchCanvasInspectionData(workspaceId, normalizedSourcePath)
      : fetchCanvasData(workspaceId, normalizedSourcePath);

    void request
      .then((response) => {
        if (cancelled) {
          return;
        }

        setData(response);
        if (inspectionEnabled && isInspectionResponse(response)) {
          setInspectionSceneManifest(response.sceneManifest ?? EMPTY_SCENE_MANIFEST);
          setAnchorCommentDocument(response.anchorCommentDocument ?? EMPTY_ANCHOR_COMMENT_DOCUMENT);
        } else {
          setInspectionSceneManifest(EMPTY_SCENE_MANIFEST);
          setAnchorCommentDocument(EMPTY_ANCHOR_COMMENT_DOCUMENT);
        }
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load canvas.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [inspectionEnabled, refreshToken, sceneRegistry, sourcePath, workspaceId]);

  useEffect(() => {
    if (inspectModeActive) {
      return;
    }

    setSelectedSceneElementId(null);
    setCommentDraft("");
    setSaveCommentError(null);
  }, [inspectModeActive]);

  useEffect(() => {
    if (!selectedSceneElementId) {
      return;
    }

    const stillExists = effectiveSceneManifest.elements.some(
      (element) => element.id === selectedSceneElementId
    );

    if (!stillExists) {
      setSelectedSceneElementId(null);
      setCommentDraft("");
      setSaveCommentError(null);
    }
  }, [effectiveSceneManifest, selectedSceneElementId]);

  useEffect(() => {
    onExportStateChange?.({
      exportRoot: sceneRootRef.current,
      hasUnsavedCommentDraft: commentDraft.trim().length > 0,
      ready: !loading && !!data?.compiledDocument,
    });
  }, [commentDraft, data, loading, onExportStateChange]);

  if (loading) {
    return <CanvasRouteFrame layout={layout} loading />;
  }

  if (error) {
    return <CanvasRouteFrame layout={layout} error={<p style={{ margin: 0 }}>{error}</p>} />;
  }

  if (!data) {
    return (
      <CanvasRouteFrame
        layout={layout}
        error={<p style={{ margin: 0 }}>Canvas data is unavailable.</p>}
      />
    );
  }

  if (data.renderStatus === "error") {
    return (
      <CanvasRouteFrame
        layout={layout}
        title={data.title}
        error={
          <div>
            <h2 style={{ marginTop: 0 }}>Render failed</h2>
            <p style={{ marginBottom: 0 }}>{data.lastError?.message ?? "Unknown canvas error."}</p>
          </div>
        }
      />
    );
  }

  if (!data.compiledDocument) {
    return (
      <CanvasRouteFrame
        layout={layout}
        error={<p style={{ margin: 0 }}>Canvas data is unavailable.</p>}
      />
    );
  }

  if (data.compiledDocument.kind === "architecture_canvas") {
    return (
      <CanvasRouteFrame
        layout={layout}
        title={data.compiledDocument.title}
        summary={data.compiledDocument.summary}
        variant="architecture"
      >
        <div
          className={`canvas-content__scene${exportMode ? " canvas-content__scene--export" : ""}`}
          data-scene-element-count={effectiveSceneManifest.elements.length}
          ref={sceneRootRef}
        >
          <ArchitectureCanvasRenderer
            canvas={data.compiledDocument}
            sceneRegistry={sceneRegistry}
            sceneRootRef={sceneRootRef}
          />
          <CanvasCommentLayer document={anchorCommentDocument} />
          <CanvasOverlayLayer
            annotationCommand={annotationCommand}
            editable={editable}
            exportMode={exportMode}
            inspectSelectionElementId={selectedSceneElementId}
            onInspectSelectionChange={(element) => {
              setSelectedSceneElementId(element?.id ?? null);
              setCommentDraft("");
              setSaveCommentError(null);
            }}
            onChange={(overlayDocument) => {
              void persistOverlay(workspaceId, sourcePath, overlayDocument, setData);
            }}
            overlayDocument={data.overlayDocument}
            semanticElements={effectiveSceneManifest.elements}
            tool={annotationTool}
          />
        </div>
        {renderInspectComposer({
          anchorCommentDocument,
          commentDraft,
          exportMode,
          inspectModeActive,
          onCommentDraftChange: setCommentDraft,
          onDismiss: () => {
            setSelectedSceneElementId(null);
            setCommentDraft("");
            setSaveCommentError(null);
          },
          onSave: async () => {
            if (!selectedSceneElement) {
              return;
            }

            const trimmed = commentDraft.trim();
            if (!trimmed) {
              return;
            }

            setSavingComment(true);
            setSaveCommentError(null);

            const timestamp = new Date().toISOString();
            const nextDocument: CanvasAnchorCommentDocument = {
              ...anchorCommentDocument,
              comments: [
                ...anchorCommentDocument.comments,
                {
                  id: `comment-${Date.now()}`,
                  elementIds: [selectedSceneElement.id],
                  targets: [selectedSceneElement],
                  selectionRect: selectedSceneElement.rect,
                  body: trimmed,
                  status: "open",
                  createdAt: timestamp,
                  updatedAt: timestamp,
                },
              ],
            };

            try {
              const saved = await saveCanvasAnchorComments(workspaceId, sourcePath, nextDocument);
              setAnchorCommentDocument(saved);
              setSelectedSceneElementId(null);
              setCommentDraft("");
            } catch {
              setSaveCommentError(t("code_editor.canvas_inspect_save_failed"));
            } finally {
              setSavingComment(false);
            }
          },
          saveCommentError,
          savingComment,
          selectedSceneElement,
          t,
        })}
      </CanvasRouteFrame>
    );
  }

  return (
    <CanvasRouteFrame layout={layout} title={data.compiledDocument.title}>
      <div
        className={`canvas-content__scene${exportMode ? " canvas-content__scene--export" : ""}`}
        data-scene-element-count={effectiveSceneManifest.elements.length}
        ref={sceneRootRef}
      >
        <ReportCanvasRenderer
          canvas={data.compiledDocument}
          sceneRegistry={sceneRegistry}
          sceneRootRef={sceneRootRef}
        />
        <CanvasCommentLayer document={anchorCommentDocument} />
        <CanvasOverlayLayer
          annotationCommand={annotationCommand}
          editable={editable}
          exportMode={exportMode}
          inspectSelectionElementId={selectedSceneElementId}
          onInspectSelectionChange={(element) => {
            setSelectedSceneElementId(element?.id ?? null);
            setCommentDraft("");
            setSaveCommentError(null);
          }}
          onChange={(overlayDocument) => {
            void persistOverlay(workspaceId, sourcePath, overlayDocument, setData);
          }}
          overlayDocument={data.overlayDocument}
          semanticElements={effectiveSceneManifest.elements}
          tool={annotationTool}
        />
      </div>
      {renderInspectComposer({
        anchorCommentDocument,
        commentDraft,
        exportMode,
        inspectModeActive,
        onCommentDraftChange: setCommentDraft,
        onDismiss: () => {
          setSelectedSceneElementId(null);
          setCommentDraft("");
          setSaveCommentError(null);
        },
        onSave: async () => {
          if (!selectedSceneElement) {
            return;
          }

          const trimmed = commentDraft.trim();
          if (!trimmed) {
            return;
          }

          setSavingComment(true);
          setSaveCommentError(null);

          const timestamp = new Date().toISOString();
          const nextDocument: CanvasAnchorCommentDocument = {
            ...anchorCommentDocument,
            comments: [
              ...anchorCommentDocument.comments,
              {
                id: `comment-${Date.now()}`,
                elementIds: [selectedSceneElement.id],
                targets: [selectedSceneElement],
                selectionRect: selectedSceneElement.rect,
                body: trimmed,
                status: "open",
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
          };

          try {
            const saved = await saveCanvasAnchorComments(workspaceId, sourcePath, nextDocument);
            setAnchorCommentDocument(saved);
            setSelectedSceneElementId(null);
            setCommentDraft("");
          } catch {
            setSaveCommentError(t("code_editor.canvas_inspect_save_failed"));
          } finally {
            setSavingComment(false);
          }
        },
        saveCommentError,
        savingComment,
        selectedSceneElement,
        t,
      })}
    </CanvasRouteFrame>
  );
}

async function persistOverlay(
  workspaceId: string,
  sourcePath: string,
  overlayDocument: CanvasOverlayDocument,
  setData: Dispatch<SetStateAction<CanvasDataResponse | null>>
) {
  try {
    const saved = await saveCanvasOverlay(workspaceId, sourcePath, overlayDocument);
    setData((current) => (current ? { ...current, overlayDocument: saved } : current));
  } catch {
    // Keep the current overlay visible locally; route-level error handling can be added later.
  }
}

function renderInspectComposer(input: {
  anchorCommentDocument: CanvasAnchorCommentDocument;
  commentDraft: string;
  exportMode: boolean;
  inspectModeActive: boolean;
  onCommentDraftChange: (value: string) => void;
  onDismiss: () => void;
  onSave: () => void | Promise<void>;
  saveCommentError: string | null;
  savingComment: boolean;
  selectedSceneElement: CanvasSceneElement | null;
  t: ReturnType<typeof useTranslation>;
}) {
  const {
    anchorCommentDocument,
    commentDraft,
    exportMode,
    inspectModeActive,
    onCommentDraftChange,
    onDismiss,
    onSave,
    saveCommentError,
    savingComment,
    selectedSceneElement,
    t,
  } = input;

  if (exportMode || !inspectModeActive || !selectedSceneElement) {
    return null;
  }

  return (
    <section className="canvas-content__inspect-composer">
      <div className="canvas-content__inspect-composer-header">
        <div>
          <p className="canvas-content__inspect-eyebrow">
            {t("code_editor.canvas_inspect_comment_title")}
          </p>
          <strong className="canvas-content__inspect-selection-label">
            {selectedSceneElement.label ?? selectedSceneElement.id}
          </strong>
          <p className="canvas-content__inspect-meta">
            {t("code_editor.canvas_inspect_selected_label")}
            {" · "}
            {selectedSceneElement.kind}
            {" · "}
            {anchorCommentDocument.comments.length}
          </p>
        </div>
        <button className="canvas-content__inspect-dismiss" onClick={onDismiss} type="button">
          {t("code_editor.canvas_inspect_comment_cancel")}
        </button>
      </div>
      <textarea
        className="canvas-content__inspect-textarea"
        onChange={(event) => onCommentDraftChange(event.target.value)}
        placeholder={t("code_editor.canvas_inspect_comment_placeholder")}
        value={commentDraft}
      />
      {saveCommentError ? (
        <p className="canvas-content__inspect-error">{saveCommentError}</p>
      ) : null}
      <div className="canvas-content__inspect-actions">
        <button className="canvas-content__inspect-secondary" onClick={onDismiss} type="button">
          {t("code_editor.canvas_inspect_comment_cancel")}
        </button>
        <button
          className="canvas-content__inspect-primary"
          disabled={savingComment || commentDraft.trim().length === 0}
          onClick={() => {
            void onSave();
          }}
          type="button"
        >
          {t("code_editor.canvas_inspect_comment_save")}
        </button>
      </div>
    </section>
  );
}
