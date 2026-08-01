import { toPng } from "html-to-image";

interface ExportCanvasPngInput {
  element: HTMLElement | null;
  filename: string;
}

export async function exportCanvasPng({ element, filename }: ExportCanvasPngInput): Promise<void> {
  if (!element) {
    throw new Error("canvas_export_root_missing");
  }

  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 1,
  });

  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}
