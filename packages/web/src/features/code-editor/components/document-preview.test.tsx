import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentPreview } from "./document-preview";

vi.mock("../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    switch (key) {
      case "code_editor.preview_loading":
        return "Loading preview...";
      case "code_editor.preview_unavailable":
        return "Preview unavailable";
      case "code_editor.preview_retry":
        return "Retry";
      default:
        return key;
    }
  },
}));

describe("DocumentPreview", () => {
  it("renders an iframe when src is available and falls back to retry UI on error", () => {
    const onRetry = vi.fn();
    render(
      <DocumentPreview
        title="README.md"
        src="/api/preview/session/session-1/README.md?rev=1"
        allowScripts={true}
        isLoading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    expect(screen.getByTitle("README.md preview")).toHaveAttribute(
      "src",
      "/api/preview/session/session-1/README.md?rev=1"
    );
    expect(screen.getByTitle("README.md preview")).toHaveAttribute("sandbox", "allow-scripts");

    fireEvent.error(screen.getByTitle("README.md preview"));
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("keeps the iframe sandbox empty when scripts are not allowed", () => {
    render(
      <DocumentPreview
        title="README.md"
        src="/api/preview/session/session-1/README.md?rev=1"
        allowScripts={false}
        isLoading={false}
        error={null}
      />
    );

    expect(screen.getByTitle("README.md preview")).toHaveAttribute("sandbox", "");
  });
});
