import { useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
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
    async (task: () => Promise<string | null>) => {
      const sequence = nextSequenceRef.current;
      nextSequenceRef.current += 1;
      inFlightCountRef.current += 1;
      setBusy(true);

      try {
        const text = await task();
        await settleSequence(sequence, text);
      } catch (error) {
        await settleSequence(sequence, null);
        const code = error instanceof UploadError ? error.code : "unknown";
        pushToast({
          kind: "error",
          title: "Upload failed",
          body: `Could not upload file(s): ${code}`,
          duration: 5_000,
        });
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        setBusy(inFlightCountRef.current > 0);
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

      await runSequence(async () => text);
    },
    [runSequence]
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
      if (!files || files.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleFiles(Array.from(files));
    };

    const onDragOver = (event: DragEvent) => {
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
  }, [containerRef, enabled, handleFiles]);

  return {
    busy,
    handleClipboardPaste,
    handleFiles,
  };
}
