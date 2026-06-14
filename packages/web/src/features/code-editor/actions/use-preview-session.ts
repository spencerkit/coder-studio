import { useEffect, useRef, useState } from "react";
import {
  createPreviewSession,
  deletePreviewSession,
  type PreviewKind,
  updatePreviewSession,
} from "../preview/api";

export function usePreviewSession(input: {
  enabled: boolean;
  workspaceId?: string;
  filePath?: string | null;
  content?: string;
  kind?: PreviewKind | null;
  debounceMs?: number;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState<number>(0);
  const [sessionTargetKey, setSessionTargetKey] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const latestContentRef = useRef(input.content ?? "");
  const lastSyncedContentRef = useRef(input.content ?? "");
  const allowScripts = input.kind === "html";
  const targetKey =
    input.enabled && input.workspaceId && input.filePath && input.kind
      ? `${input.workspaceId}:${input.kind}:${input.filePath}`
      : null;

  latestContentRef.current = input.content ?? "";

  useEffect(() => {
    if (!targetKey || !input.workspaceId || !input.filePath || !input.kind) {
      setSessionId(null);
      setPreviewUrl(null);
      setRevision(0);
      setSessionTargetKey(null);
      setIsBootstrapping(false);
      setIsSyncing(false);
      setError(null);
      lastSyncedContentRef.current = latestContentRef.current;
      return;
    }

    let cancelled = false;
    let createdSessionId: string | null = null;

    setSessionId(null);
    setPreviewUrl(null);
    setRevision(0);
    setSessionTargetKey(null);
    setIsBootstrapping(true);
    setIsSyncing(false);
    setError(null);

    void createPreviewSession({
      workspaceId: input.workspaceId,
      entryPath: input.filePath,
      kind: input.kind,
      content: latestContentRef.current,
      allowScripts,
    })
      .then((created) => {
        if (cancelled) {
          void deletePreviewSession(created.id).catch(() => undefined);
          return;
        }

        createdSessionId = created.id;
        setSessionId(created.id);
        setPreviewUrl(created.previewUrl);
        setRevision(created.revision);
        setSessionTargetKey(targetKey);
        lastSyncedContentRef.current = latestContentRef.current;
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "preview_bootstrap_failed");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      });

    return () => {
      cancelled = true;
      if (createdSessionId) {
        void deletePreviewSession(createdSessionId).catch(() => undefined);
      }
    };
  }, [allowScripts, input.filePath, input.kind, input.workspaceId, retryNonce, targetKey]);

  useEffect(() => {
    if (!targetKey || !sessionId || !previewUrl || sessionTargetKey !== targetKey) {
      return;
    }

    if (lastSyncedContentRef.current === latestContentRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsSyncing(true);
      void updatePreviewSession(sessionId, { content: latestContentRef.current })
        .then((updated) => {
          setRevision(updated.revision);
          lastSyncedContentRef.current = latestContentRef.current;
          setError(null);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "preview_sync_failed");
        })
        .finally(() => {
          setIsSyncing(false);
        });
    }, input.debounceMs ?? 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [input.content, input.debounceMs, previewUrl, sessionId, sessionTargetKey, targetKey]);

  return {
    iframeSrc: previewUrl ? `${previewUrl}?rev=${revision}` : null,
    allowScripts,
    isBootstrapping,
    isSyncing,
    error,
    retry: () => setRetryNonce((current) => current + 1),
  };
}
