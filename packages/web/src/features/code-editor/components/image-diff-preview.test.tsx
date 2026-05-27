import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageDiffPreview } from "./image-diff-preview";

function getPane(label: "Base" | "Current"): HTMLElement {
  const header = screen.getByText(label);
  const pane = header.closest("section");
  expect(pane).toBeTruthy();
  return pane as HTMLElement;
}

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

    expect(within(getPane("Base")).getByText("No base image")).toBeInTheDocument();
    expect(
      within(getPane("Current")).getByRole("img", { name: "assets/new.png current" })
    ).toBeInTheDocument();
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

    expect(
      within(getPane("Base")).getByRole("img", { name: "assets/deleted.png base" })
    ).toBeInTheDocument();
    expect(within(getPane("Current")).getByText("No current image")).toBeInTheDocument();
  });

  it("renders a pane-local error state when one side fails to load", () => {
    render(
      <ImageDiffPreview
        path="assets/logo.png"
        mime="image/png"
        status="modified"
        beforeUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=INDEX"
        afterUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png"
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "assets/logo.png base" }));

    expect(within(getPane("Base")).getByText("Preview unavailable")).toBeInTheDocument();
    expect(
      within(getPane("Current")).getByRole("img", { name: "assets/logo.png current" })
    ).toBeInTheDocument();
  });

  it("lets the user retry after an image load failure without changing the url", () => {
    render(
      <ImageDiffPreview
        path="assets/logo.png"
        mime="image/png"
        status="modified"
        beforeUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=INDEX"
        afterUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png"
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "assets/logo.png base" }));

    const basePane = getPane("Base");
    expect(within(basePane).getByText("Preview unavailable")).toBeInTheDocument();

    fireEvent.click(within(basePane).getByRole("button", { name: "Retry" }));

    expect(within(basePane).queryByText("Preview unavailable")).not.toBeInTheDocument();
    expect(within(basePane).getByRole("img", { name: "assets/logo.png base" })).toBeInTheDocument();
  });

  it("resets a pane error state when its image url changes", () => {
    const { rerender } = render(
      <ImageDiffPreview
        path="assets/logo.png"
        mime="image/png"
        status="modified"
        beforeUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=INDEX"
        afterUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png"
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "assets/logo.png current" }));
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();

    rerender(
      <ImageDiffPreview
        path="assets/logo.png"
        mime="image/png"
        status="modified"
        beforeUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=INDEX"
        afterUrl="/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=HEAD"
      />
    );

    expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "assets/logo.png current" })).toHaveAttribute(
      "src",
      "/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=HEAD"
    );
  });
});
