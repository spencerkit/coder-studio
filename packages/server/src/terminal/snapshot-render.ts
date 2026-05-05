export interface RenderOptions {
  maxLines: number;
  maxChars: number;
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;<>?]*[a-zA-Z>=~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b/g, "")
    .trim();
}

export function renderSnapshotToText(data: Buffer, options: RenderOptions): string {
  const text = stripAnsi(data.toString("utf8"));
  const lines = text.split("\n");

  while (lines.length > 0 && lines.at(-1)?.trim() === "") {
    lines.pop();
  }

  return lines.slice(-options.maxLines).join("\n").slice(-options.maxChars);
}
