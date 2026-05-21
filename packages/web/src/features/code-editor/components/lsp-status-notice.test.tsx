import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LspStatusNotice } from "./lsp-status-notice";

describe("LspStatusNotice", () => {
  it("renders an install action when the server is missing and auto-install is supported", () => {
    const onInstall = vi.fn();

    render(
      <LspStatusNotice
        state={{
          kind: "tool_missing",
          serverKind: "python",
          displayName: "Python language server",
          errorCode: "lsp_tool_missing",
          message: "Python language server is not installed",
          autoInstallSupported: true,
          missingCommands: ["pylsp"],
          missingPrerequisites: [],
        }}
        onInstall={onInstall}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("renders a retry action when installation failed", () => {
    const onRetry = vi.fn();

    render(
      <LspStatusNotice
        state={{
          kind: "failed",
          serverKind: "rust",
          displayName: "Rust language server",
          errorCode: "lsp_install_failed",
          message: "Download failed",
          autoInstallSupported: true,
          missingCommands: [],
          missingPrerequisites: [],
        }}
        onRetry={onRetry}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render an install action when prerequisites are missing", () => {
    render(
      <LspStatusNotice
        state={{
          kind: "tool_missing",
          serverKind: "go",
          displayName: "Go language server",
          errorCode: "lsp_prerequisite_missing",
          message: "Missing prerequisites: go",
          autoInstallSupported: true,
          missingCommands: ["gopls"],
          missingPrerequisites: ["go"],
        }}
      />
    );

    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.getByText("Missing prerequisites: go")).toBeInTheDocument();
  });

  it("renders a disabled notice without install or retry actions", () => {
    render(
      <LspStatusNotice
        state={{
          kind: "disabled",
          mode: "off",
          message: "LSP is turned off in Settings to reduce memory usage.",
        }}
        onInstall={vi.fn()}
        onRetry={vi.fn()}
        installing={false}
      />
    );

    expect(screen.getByText("Language server disabled")).toBeInTheDocument();
    expect(
      screen.getByText("LSP is turned off in Settings to reduce memory usage.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
