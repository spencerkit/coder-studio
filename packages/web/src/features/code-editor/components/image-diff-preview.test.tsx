import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageDiffPreview } from "./image-diff-preview";

describe("ImageDiffPreview", () => {
  it("renders baseline image on top and workspace image on bottom for modified files", () => {
    render(
      <ImageDiffPreview
        path="assets/logo.png"
        mime="image/png"
        status="modified"
        beforeUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=INDEX"
        afterUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png"
      />
    );

    const images = screen.getAllByRole("img");
    expect(images[0]).toHaveAttribute("alt", "assets/logo.png base");
    expect(images[1]).toHaveAttribute("alt", "assets/logo.png current");
  });

  it("renders an empty top state for added images", () => {
    render(
      <ImageDiffPreview
        path="assets/new.png"
        mime="image/png"
        status="added"
        afterUrl="/api/file?workspaceId=ws-1&path=assets%2Fnew.png"
      />
    );

    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "assets/new.png current" })).toBeInTheDocument();
  });

  it("renders an empty bottom state for deleted images", () => {
    render(
      <ImageDiffPreview
        path="assets/deleted.png"
        mime="image/png"
        status="deleted"
        beforeUrl="/api/file?workspaceId=ws-1&path=assets%2Fdeleted.png&revision=INDEX"
      />
    );

    expect(screen.getByRole("img", { name: "assets/deleted.png base" })).toBeInTheDocument();
    expect(screen.getByText("No image")).toBeInTheDocument();
  });
});
