import { useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../lib/workspace-path-drag";
import { pushToastAtom } from "../../notifications/atoms";
import { quoteShellSingle } from "./quote-shell.js";
import { UploadError, uploadFiles } from "./upload-files.js";

interface Options {
  containerRef: RefObject<HTMLElement | null>;
  workspaceId: string;
  sendTextToTerminal: (text: string) => Promise<void>;
  enabled: boolean;
}

async function clipboardItemToFile(item: ClipboardItem): Promise<File | null> {
  const fileType = item.types.find((type) => type.startsWith("image/"));
  if (!fileType) {
    return null;
  }

  const blob = await item.getType(fileType);
  const extension = fileType.split("/")[1] ?? "png";
  return new File([blob], `clipboard.${extension}`, { type: fileType });
}

export interface PasteDropUploadActions {
  handleClipboardPaste: () => Promise<void>;
  handleFiles: (files: File[]) => Promise<void>;
  busy: boolean;
}

interface RunSequenceOptions {
  trackBusy?: boolean;
  onError?: (error: unknown) => void;
}

export function usePasteDropUpload(opts: Options): PasteDropUploadActions {
  const { containerRef, workspaceId, sendTextToTerminal, enabled } = opts;
  const [busy, setBusy] = useState(false);
  const inFlightCountRef = useRef(0);
  const nextSequenceRef = useRef(0);
  const nextSequenceToFlushRef = useRef(0);
  const completedTextsRef = useRef(new Map<number, string | null>());
  const flushChainRef = useRef(Promise.resolve());
  const pushToast = useSetAtom(pushToastAtom);

  const settleSequence = useCallback(
    async (sequence: number, text: string | null) => {
      completedTextsRef.current.set(sequence, text);
      flushChainRef.current = flushChainRef.current.then(async () => {
        while (completedTextsRef.current.has(nextSequenceToFlushRef.current)) {
          const currentSequence = nextSequenceToFlushRef.current;
          const currentText = completedTextsRef.current.get(currentSequence) ?? null;
          completedTextsRef.current.delete(currentSequence);
          nextSequenceToFlushRef.current += 1;

          if (currentText) {
            await sendTextToTerminal(currentText);
          }
        }
      });
      await flushChainRef.current;
    },
    [sendTextToTerminal]
  );

  const runSequence = useCallback(
    async (task: () => Promise<string | null>, options?: RunSequenceOptions) => {
      const { trackBusy = true, onError } = options ?? {};
      const sequence = nextSequenceRef.current;
      nextSequenceRef.current += 1;

      if (trackBusy) {
        inFlightCountRef.current += 1;
        setBusy(true);
      }

      try {
        const text = await task();
        await settleSequence(sequence, text);
      } catch (error) {
        await settleSequence(sequence, null);
        if (onError) {
          onError(error);
          return;
        }

        const code = error instanceof UploadError ? error.code : "unknown";
        pushToast({
          kind: "error",
          title: "Upload failed",
          body: `Could not upload file(s): ${code}`,
          duration: 5_000,
        });
      } finally {
        if (trackBusy) {
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
          setBusy(inFlightCountRef.current > 0);
        }
      }
    },
    [pushToast, settleSequence]
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      await runSequence(async () => {
        const uploaded = await uploadFiles({ workspaceId, files });
        if (uploaded.length === 0) {
          return null;
        }

        return `${uploaded.map((file) => quoteShellSingle(file.path)).join(" ")} `;
      });
    },
    [runSequence, workspaceId]
  );

  const handleText = useCallback(
    async (text: string) => {
      if (!text) {
        return;
      }

      await runSequence(async () => text, {
        trackBusy: false,
        onError: (error) => {
          throw error;
        },
      });
    },
    [runSequence]
  );

  const handleWorkspacePathDrop = useCallback(
    async (dataTransfer: DataTransfer | null | undefined) => {
      const payload = getWorkspacePathDragPayload(dataTransfer);
      if (!payload) {
        pushToast({
          kind: "error",
          title: "Drop failed",
          body: "Could not read the dragged workspace path.",
          duration: 3_000,
        });
        return;
      }

      if (payload.workspaceId !== workspaceId) {
        pushToast({
          kind: "error",
          title: "Drop failed",
          body: "You can only drop paths from the current workspace.",
          duration: 3_000,
        });
        return;
      }

      await runSequence(async () => `${quoteShellSingle(payload.path)} `, {
        trackBusy: false,
        onError: (error) => {
          console.debug("Workspace path drop failed:", error);
          pushToast({
            kind: "error",
            title: "Drop failed",
            body: "Could not insert the dragged path into the terminal.",
            duration: 3_000,
          });
        },
      });
    },
    [pushToast, runSequence, workspaceId]
  );

  const handleClipboardPaste = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const clipboard = navigator.clipboard;
    if (!clipboard) {
      throw new Error("Clipboard API not available");
    }

    try {
      const readClipboardItems = (
        clipboard as Clipboard & {
          read?: () => Promise<ClipboardItem[]>;
        }
      ).read;

      if (typeof readClipboardItems === "function") {
        const items = await readClipboardItems.call(clipboard);
        const files: File[] = [];
        for (const item of items) {
          const file = await clipboardItemToFile(item);
          if (file) {
            files.push(file);
          }
        }

        if (files.length > 0) {
          await handleFiles(files);
          return;
        }
      }
    } catch (error) {
      // Fall back to text read below when image clipboard access is unsupported.
      console.debug("Clipboard image read failed, trying text:", error);
    }

    try {
      const readText = clipboard.readText?.bind(clipboard);
      if (!readText) {
        throw new Error("Clipboard text read not available");
      }

      const text = await readText();
      if (!text) {
        pushToast({
          kind: "info",
          title: "Paste",
          body: "Clipboard is empty",
          duration: 2_000,
        });
        return;
      }

      await handleText(text);
    } catch (error) {
      pushToast({
        kind: "error",
        title: "Paste failed",
        body: "Could not read from clipboard. Please check permissions.",
        duration: 3_000,
      });
      throw error;
    }
  }, [enabled, handleFiles, handleText, pushToast]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) {
      return;
    }

    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleFiles(Array.from(files));
    };

    const onDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void handleFiles(Array.from(files));
        return;
      }

      if (!hasWorkspacePathDragType(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleWorkspacePathDrop(event.dataTransfer);
    };

    const onDragOver = (event: DragEvent) => {
      if (hasWorkspacePathDragType(event.dataTransfer)) {
        event.preventDefault();
        return;
      }

      const types = Array.from(event.dataTransfer?.types ?? []);
      if (types.includes("Files")) {
        event.preventDefault();
      }
    };

    element.addEventListener("paste", onPaste, { capture: true });
    element.addEventListener("drop", onDrop, { capture: true });
    element.addEventListener("dragover", onDragOver, { capture: true });

    return () => {
      element.removeEventListener("paste", onPaste, { capture: true });
      element.removeEventListener("drop", onDrop, { capture: true });
      element.removeEventListener("dragover", onDragOver, { capture: true });
    };
  }, [containerRef, enabled, handleFiles, handleWorkspacePathDrop]);

  return {
    busy,
    handleClipboardPaste,
    handleFiles,
  };
}
