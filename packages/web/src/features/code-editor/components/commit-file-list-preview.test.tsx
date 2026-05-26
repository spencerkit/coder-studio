import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommitFileListPreview } from "./commit-file-list-preview";

describe("CommitFileListPreview", () => {
  it("renders commit files and opens a selected commit diff", () => {
    const onOpenFile = vi.fn();
    const files = [
      {
        path: "src/app.tsx",
        status: "modified" as const,
        renderAs: "text" as const,
      },
      {
        path: "src/renamed.ts",
        oldPath: "src/old.ts",
        status: "renamed" as const,
        renderAs: "text" as const,
      },
    ];

    render(
      <CommitFileListPreview
        preview={{
          kind: "commit-file-list",
          path: "abc123",
          title: "abc123 · commit subject",
          commit: {
            sha: "abc123",
            shortSha: "abc123",
            subject: "commit subject",
            authorName: "Spencer",
            authoredAt: 1,
          },
          files,
        }}
        onOpenFile={onOpenFile}
      />
    );

    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/old.ts -> src/renamed.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src/app.tsx" }));

    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
  });
});
