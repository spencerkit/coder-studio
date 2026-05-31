import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommitFileListPreview } from "./commit-file-list-preview";

describe("CommitFileListPreview", () => {
  it("renders commit files with split path metadata and opens a selected commit diff", () => {
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

    const modifiedRow = screen.getByRole("button", { name: "src/app.tsx modified" });
    expect(within(modifiedRow).getByText("app.tsx")).toBeInTheDocument();
    expect(within(modifiedRow).getByText("src/")).toBeInTheDocument();
    expect(within(modifiedRow).getByText("modified")).toBeInTheDocument();

    const renamedRow = screen.getByRole("button", { name: "src/old.ts -> src/renamed.ts renamed" });
    expect(within(renamedRow).getByText("renamed.ts")).toBeInTheDocument();
    expect(within(renamedRow).getByText("src/old.ts")).toBeInTheDocument();
    expect(within(renamedRow).getByText("renamed")).toBeInTheDocument();

    fireEvent.click(modifiedRow);

    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
  });
});
