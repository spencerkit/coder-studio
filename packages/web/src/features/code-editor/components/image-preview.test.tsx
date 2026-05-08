import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImagePreview } from "./image-preview";

describe("ImagePreview", () => {
  it("preserves the migrated empty-state fallback when image loading fails", () => {
    render(
      <ImagePreview alt="Preview asset" mime="image/png" sizeBytes={128} url="/api/file/test.png" />
    );

    fireEvent.error(screen.getByRole("img", { name: "Preview asset" }));

    expect(document.querySelector(".git-diff-empty")).toBeTruthy();
    expect(screen.getByText("Preview unavailable")).toHaveClass("git-diff-empty-title");
    expect(screen.getByText(/could not be loaded/i)).toHaveClass("git-diff-empty-body");
  });
});
