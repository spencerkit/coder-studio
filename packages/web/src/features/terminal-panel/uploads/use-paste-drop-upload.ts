import { atom, useAtom, useSetAtom, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../lib/i18n";
import { getSkillPathDragPayload, hasSkillPathDragType } from "../../../lib/skill-path-drag";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../lib/workspace-path-drag";
import { pushToastAtom } from "../../notifications/atoms";
import { quoteShellSingle } from "./quote-shell.js";
import { UploadError, type UploadedFileMeta, uploadFiles } from "./upload-files.js";

interface Options {
  containerRef: RefObject<HTMLElement | null>;
  workspaceId: string;
  terminalId: string;
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

export interface PendingUploadImage {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  type: string;
}

interface PendingUploadBucket {
  images: PendingUploadImage[];
  nextImageId: number;
}

export interface PasteDropUploadActions {
  handleClipboardPaste: () => Promise<void>;
  handleFiles: (files: File[]) => Promise<void>;
  collectPendingFiles: (files: File[]) => void;
  uploadPendingImages: () => Promise<UploadedFileMeta[]>;
  clearPendingImages: () => void;
  removePendingImage: (imageId: string) => void;
  pendingImages: PendingUploadImage[];
  busy: boolean;
}

const pendingUploadBucketAtomFamily = atomFamily((_: string) =>
  atom<PendingUploadBucket>({
    images: [],
    nextImageId: 0,
  })
);

function getPendingUploadBucketKey(workspaceId: string, terminalId: string): string {
  return `${workspaceId}:${terminalId}`;
}

interface RunSequenceOptions {
  trackBusy?: boolean;
  onError?: (error: unknown) => void;
}

export function usePasteDropUpload(opts: Options): PasteDropUploadActions {
  const { containerRef, workspaceId, terminalId, sendTextToTerminal, enabled } = opts;
  const store = useStore();
  const pendingUploadBucketAtom = pendingUploadBucketAtomFamily(
    getPendingUploadBucketKey(workspaceId, terminalId)
  );
  const [pendingUploadBucket, setPendingUploadBucket] = useAtom(pendingUploadBucketAtom);
  const [busy, setBusy] = useState(false);
  const inFlightCountRef = useRef(0);
  const nextSequenceRef = useRef(0);
  const nextSequenceToFlushRef = useRef(0);
  const completedTextsRef = useRef(new Map<number, string | null>());
  const flushChainRef = useRef(Promise.resolve());
  const pendingImages = pendingUploadBucket.images;
  const pendingImagesRef = useRef<PendingUploadImage[]>(pendingImages);
  const pushToast = useSetAtom(pushToastAtom);
  const t = useTranslation();
  pendingImagesRef.current = pendingImages;

  const revokePendingImages = useCallback((images: PendingUploadImage[]) => {
    for (const image of images) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }, []);

  const updatePendingBucket = useCallback(
    (updater: (bucket: PendingUploadBucket) => PendingUploadBucket) => {
      const previousBucket = store.get(pendingUploadBucketAtom);
      const nextBucket = updater(previousBucket);

      if (nextBucket === previousBucket) {
        return;
      }

      const previousImages = previousBucket.images;
      const nextImages = nextBucket.images;
      const nextIds = new Set(nextImages.map((image) => image.id));
      const removedImages = previousImages.filter((image) => !nextIds.has(image.id));

      pendingImagesRef.current = nextImages;
      setPendingUploadBucket(nextBucket);
      revokePendingImages(removedImages);
    },
    [pendingUploadBucketAtom, revokePendingImages, setPendingUploadBucket, store]
  );

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
          title: t("terminal.upload.upload_failed"),
          body: t("terminal.upload.upload_failed_body", { code }),
          duration: 5_000,
        });
      } finally {
        if (trackBusy) {
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
          setBusy(inFlightCountRef.current > 0);
        }
      }
    },
    [pushToast, settleSequence, t]
  );

  const collectPendingFiles = useCallback(
    (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) {
        return;
      }

      updatePendingBucket((bucket) => {
        let nextImageId = bucket.nextImageId;
        const nextPendingImages = imageFiles.map((file) => {
          const id = `pending-upload-image-${nextImageId}`;
          nextImageId += 1;
          return {
            id,
            file,
            previewUrl: URL.createObjectURL(file),
            name: file.name,
            type: file.type,
          };
        });

        return {
          images: [...bucket.images, ...nextPendingImages],
          nextImageId,
        };
      });
    },
    [updatePendingBucket]
  );

  const clearPendingImages = useCallback(() => {
    updatePendingBucket((bucket) =>
      bucket.images.length === 0
        ? bucket
        : {
            ...bucket,
            images: [],
          }
    );
  }, [updatePendingBucket]);

  const removePendingImage = useCallback(
    (imageId: string) => {
      updatePendingBucket((bucket) => {
        const images = bucket.images.filter((image) => image.id !== imageId);
        return images.length === bucket.images.length
          ? bucket
          : {
              ...bucket,
              images,
            };
      });
    },
    [updatePendingBucket]
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

  const uploadPendingImages = useCallback(async () => {
    const images = pendingImagesRef.current;
    if (images.length === 0) {
      return [];
    }

    inFlightCountRef.current += 1;
    setBusy(true);

    try {
      const uploaded = await uploadFiles({
        workspaceId,
        files: images.map((image) => image.file),
      });
      return uploaded;
    } catch (error) {
      const code = error instanceof UploadError ? error.code : "unknown";
      pushToast({
        kind: "error",
        title: t("terminal.upload.upload_failed"),
        body: t("terminal.upload.upload_failed_body", { code }),
        duration: 5_000,
      });
      throw error;
    } finally {
      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      setBusy(inFlightCountRef.current > 0);
    }
  }, [pushToast, t, workspaceId]);

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
          title: t("terminal.upload.drop_failed"),
          body: t("terminal.upload.drop_read_failed"),
          duration: 3_000,
        });
        return;
      }

      if (payload.workspaceId !== workspaceId) {
        pushToast({
          kind: "error",
          title: t("terminal.upload.drop_failed"),
          body: t("terminal.upload.drop_workspace_mismatch"),
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
            title: t("terminal.upload.drop_failed"),
            body: t("terminal.upload.drop_insert_failed"),
            duration: 3_000,
          });
        },
      });
    },
    [pushToast, runSequence, t, workspaceId]
  );

  const handleSkillPathDrop = useCallback(
    async (dataTransfer: DataTransfer | null | undefined) => {
      const payload = getSkillPathDragPayload(dataTransfer);
      if (!payload) {
        pushToast({
          kind: "error",
          title: t("terminal.upload.drop_failed"),
          body: t("terminal.upload.drop_read_failed"),
          duration: 3_000,
        });
        return;
      }

      await runSequence(async () => `${quoteShellSingle(payload.absolutePath)} `, {
        trackBusy: false,
        onError: (error) => {
          console.debug("Skill path drop failed:", error);
          pushToast({
            kind: "error",
            title: t("terminal.upload.drop_failed"),
            body: t("terminal.upload.drop_insert_failed"),
            duration: 3_000,
          });
        },
      });
    },
    [pushToast, runSequence, t]
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
          title: t("terminal.upload.paste"),
          body: t("terminal.upload.clipboard_empty"),
          duration: 2_000,
        });
        return;
      }

      await handleText(text);
    } catch (error) {
      pushToast({
        kind: "error",
        title: t("terminal.upload.paste_failed"),
        body: t("terminal.upload.paste_permission_failed"),
        duration: 3_000,
      });
      throw error;
    }
  }, [enabled, handleFiles, handleText, pushToast, t]);

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

      const filesArray = Array.from(files);

      event.preventDefault();
      event.stopPropagation();

      // Pasted files upload immediately and write their paths into the terminal.
      // This keeps image paste useful without feeding the pending preview strip.
      void handleFiles(filesArray);
    };

    const onDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const otherFiles = Array.from(files).filter((file) => !file.type.startsWith("image/"));

        event.preventDefault();
        event.stopPropagation();
        if (imageFiles.length > 0) {
          collectPendingFiles(imageFiles);
        }
        if (otherFiles.length > 0) {
          void handleFiles(otherFiles);
        }
        return;
      }

      if (
        !hasWorkspacePathDragType(event.dataTransfer) &&
        !hasSkillPathDragType(event.dataTransfer)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (hasWorkspacePathDragType(event.dataTransfer)) {
        void handleWorkspacePathDrop(event.dataTransfer);
        return;
      }

      void handleSkillPathDrop(event.dataTransfer);
    };

    const onDragOver = (event: DragEvent) => {
      if (
        hasWorkspacePathDragType(event.dataTransfer) ||
        hasSkillPathDragType(event.dataTransfer)
      ) {
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
  }, [
    collectPendingFiles,
    containerRef,
    enabled,
    handleFiles,
    handleSkillPathDrop,
    handleWorkspacePathDrop,
  ]);

  return {
    busy,
    handleClipboardPaste,
    handleFiles,
    collectPendingFiles,
    uploadPendingImages,
    clearPendingImages,
    removePendingImage,
    pendingImages,
  };
}
