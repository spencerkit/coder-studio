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

export function usePasteDropUpload(opts: Options): { busy: boolean } {
  const { containerRef, workspaceId, sendTextToTerminal, enabled } = opts;
  const [busy, setBusy] = useState(false);
  const inFlightCountRef = useRef(0);
  const nextSequenceRef = useRef(0);
  const nextSequenceToFlushRef = useRef(0);
  const completedTextsRef = useRef(new Map<number, string | null>());
  const flushChainRef = useRef(Promise.resolve());
  const pushToast = useSetAtom(pushToastAtom);

  const flushCompletedSequences = useCallback(async () => {
    while (completedTextsRef.current.has(nextSequenceToFlushRef.current)) {
      const sequence = nextSequenceToFlushRef.current;
      const text = completedTextsRef.current.get(sequence) ?? null;
      completedTextsRef.current.delete(sequence);
      nextSequenceToFlushRef.current += 1;

      if (text) {
        await sendTextToTerminal(text);
      }
    }
  }, [sendTextToTerminal]);

  const settleSequence = useCallback(
    async (sequence: number, text: string | null) => {
      completedTextsRef.current.set(sequence, text);
      flushChainRef.current = flushChainRef.current.then(() => flushCompletedSequences());
      await flushChainRef.current;
    },
    [flushCompletedSequences]
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const sequence = nextSequenceRef.current;
      nextSequenceRef.current += 1;
      inFlightCountRef.current += 1;
      setBusy(true);
      try {
        const uploaded = await uploadFiles({ workspaceId, files });
        if (uploaded.length === 0) {
          await settleSequence(sequence, null);
          return;
        }

        const text = `${uploaded.map((file) => quoteShellSingle(file.path)).join(" ")} `;
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
    [pushToast, settleSequence, workspaceId]
  );

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

  return { busy };
}
