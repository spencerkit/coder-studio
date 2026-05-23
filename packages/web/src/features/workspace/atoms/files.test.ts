import { describe, expect, it } from "vitest";
import {
  deriveDocumentPreviewKind,
  deriveEditorModeForOpenFile,
  deriveEditorModeForPath,
  isDocumentPreviewPath,
  isPreviewByDefaultPath,
} from "./files";

describe("workspace file preview classification", () => {
  it("classifies markdown and html files as document previews", () => {
    expect(isPreviewByDefaultPath("README.md")).toBe(true);
    expect(isPreviewByDefaultPath("docs/page.html")).toBe(true);
    expect(isDocumentPreviewPath("docs/page.html")).toBe(true);
    expect(deriveDocumentPreviewKind("README.md")).toBe("markdown");
    expect(deriveDocumentPreviewKind("docs/page.html")).toBe("html");
    expect(deriveEditorModeForPath("README.md")).toBe("preview");
    expect(
      deriveEditorModeForOpenFile({
        kind: "text",
        path: "README.md",
        content: "# Docs",
        savedContent: "# Docs",
        baseHash: "hash-1",
        isDirty: false,
      })
    ).toBe("preview");
  });
});
