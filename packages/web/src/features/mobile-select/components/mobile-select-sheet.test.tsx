import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { MobileSelectSheet } from "./mobile-select-sheet";

function renderWithEnglishLocale(node: React.ReactNode) {
  const store = createStore();
  store.set(localeAtom, "en");

  return render(<Provider store={store}>{node}</Provider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MobileSelectSheet", () => {
  it("renders option sections and highlights the selected item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: "options",
            id: "terminals",
            items: [
              { id: "term_1", label: "Workspace Shell", meta: "Current terminal" },
              { id: "term_2", label: "Workspace Shell 2", meta: "Terminal 2" },
            ],
          },
        ]}
        selectedId="term_1"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(screen.getByRole("region", { name: "Terminal Sessions sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace Shell" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Workspace Shell" })).toHaveAccessibleDescription(
      "Current terminal"
    );

    await user.click(screen.getByRole("button", { name: "Workspace Shell 2" }));
    expect(onSelect).toHaveBeenCalledWith("term_2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders item badges with the shared tag compatibility classes without forcing all caps", () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branches"
        sections={[
          {
            kind: "options",
            id: "branches",
            items: [{ id: "origin/main", label: "origin/main", badge: "Remote" }],
          },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Remote")).toHaveClass(
      "badge",
      "badge-gray",
      "mobile-select-sheet__item-badge"
    );
  });

  it("waits for async onSelect to settle before closing when closeOnSelect is true", async () => {
    const user = userEvent.setup();
    let resolveSelect: (() => void) | null = null;
    const onSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSelect = resolve;
        })
    );
    const onClose = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: "options",
            id: "terminals",
            items: [{ id: "term_1", label: "Workspace Shell" }],
          },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole("button", { name: "Workspace Shell" }));

    expect(onSelect).toHaveBeenCalledWith("term_1");
    expect(onClose).not.toHaveBeenCalled();

    resolveSelect?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("logs and keeps the sheet open when async onSelect rejects", async () => {
    const user = userEvent.setup();
    const error = new Error("select failed");
    const onSelect = vi.fn().mockRejectedValue(error);
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: "options",
            id: "terminals",
            items: [{ id: "term_1", label: "Workspace Shell" }],
          },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole("button", { name: "Workspace Shell" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("MobileSelectSheet select failed", error);
  });

  it("filters only option sections when searchable and matches descriptions and keywords", async () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Agent Sessions"
        searchable
        searchPlaceholder="Search sessions"
        sections={[
          {
            kind: "actions",
            id: "actions",
            items: [{ id: "create", label: "Create Session", onAction: vi.fn() }],
          },
          {
            kind: "options",
            id: "sessions",
            items: [
              {
                id: "sess_1",
                label: "Claude",
                description: "Anthropic session",
                keywords: ["analysis"],
              },
              {
                id: "sess_2",
                label: "Codex",
                description: "Code generation",
                keywords: ["automation", "openai"],
              },
            ],
          },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "cod" },
    });

    expect(screen.getByRole("button", { name: "Create Session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toHaveAccessibleDescription(
      "Code generation"
    );
    expect(screen.queryByRole("button", { name: "Claude" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "Anthropic" },
    });

    expect(screen.getByRole("button", { name: "Claude" })).toHaveAccessibleDescription(
      "Anthropic session"
    );
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "automation" },
    });

    expect(screen.getByRole("button", { name: "Codex" })).toHaveAccessibleDescription(
      "Code generation"
    );
    expect(screen.queryByRole("button", { name: "Claude" })).not.toBeInTheDocument();
  });

  it("renders an inline back button when onBack is provided", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Agent Sessions"
        presentation="inline"
        sections={[
          {
            kind: "options",
            id: "sessions",
            items: [{ id: "sess_1", label: "Claude" }],
          },
        ]}
        onBack={onBack}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const header = document.querySelector(".mobile-inline-sheet__header .mobile-page-header");
    const leading = header?.querySelector(".page-header__leading");

    expect(header).not.toBeNull();
    expect(leading).not.toBeNull();
    expect(within(leading as HTMLElement).getByText("Agent Sessions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("runs a trailing item action without selecting the row", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onCloseSession = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Agent Sessions"
        sections={[
          {
            kind: "options",
            id: "sessions",
            items: [
              {
                id: "sess_2",
                label: "Codex",
                description: "Switch to agent Codex",
                meta: "CODEX",
                trailingAction: {
                  id: "close-current",
                  ariaLabel: "Close Current Session",
                  icon: <span aria-hidden="true">x</span>,
                  onAction: onCloseSession,
                },
              },
            ],
          },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    const row = screen
      .getByRole("button", {
        name: "Codex",
        description: "Switch to agent Codex CODEX",
      })
      .closest(".mobile-select-sheet__item-row");

    expect(row).not.toBeNull();

    const trailingAction = within(row as HTMLElement).getByRole("button", {
      name: "Close Current Session",
    });

    expect(trailingAction).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-lg",
      "mobile-select-sheet__item-side-action"
    );

    await user.click(trailingAction);

    expect(onCloseSession).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("preserves danger tone and disabled behavior on trailing icon actions", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Agent Sessions"
        sections={[
          {
            kind: "options",
            id: "sessions",
            items: [
              {
                id: "sess_2",
                label: "Codex",
                trailingAction: {
                  id: "close-current",
                  ariaLabel: "Close Current Session",
                  disabled: true,
                  icon: <span aria-hidden="true">x</span>,
                  onAction,
                  tone: "danger",
                },
              },
            ],
          },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const trailingAction = screen.getByRole("button", { name: "Close Current Session" });

    expect(trailingAction).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-lg",
      "mobile-select-sheet__item-side-action",
      "mobile-select-sheet__item-side-action--danger"
    );
    expect(trailingAction).toBeDisabled();

    await user.click(trailingAction);

    expect(onAction).not.toHaveBeenCalled();
  });

  it("keeps selected state on the row background and does not render a check icon", () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Agent Sessions"
        sections={[
          {
            kind: "options",
            id: "sessions",
            items: [
              {
                id: "sess_1",
                label: "Claude",
                trailingAction: {
                  id: "close-claude",
                  ariaLabel: "Close Claude",
                  icon: <span aria-hidden="true">x</span>,
                  onAction: vi.fn(),
                },
              },
              {
                id: "sess_2",
                label: "Codex",
                trailingAction: {
                  id: "close-codex",
                  ariaLabel: "Close Codex",
                  icon: <span aria-hidden="true">x</span>,
                  onAction: vi.fn(),
                },
              },
            ],
          },
        ]}
        selectedId="sess_2"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const selectedRow = screen
      .getByRole("button", { name: "Codex" })
      .closest(".mobile-select-sheet__item-row");
    const unselectedRow = screen
      .getByRole("button", { name: "Claude" })
      .closest(".mobile-select-sheet__item-row");

    expect(selectedRow).toHaveAttribute("data-selected", "true");
    expect(unselectedRow).toHaveAttribute("data-selected", "false");
    expect(document.querySelector(".mobile-select-sheet__item-check")).toBeNull();
    expect(screen.getByRole("button", { name: "Close Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Codex" })).toBeInTheDocument();
  });

  it("supports a controlled search value when the caller owns the query state", () => {
    const onSearchValueChange = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        searchable
        searchPlaceholder="Search branches"
        searchValue="feature"
        onSearchValueChange={onSearchValueChange}
        sections={[
          {
            kind: "options",
            id: "branches",
            items: [{ id: "feature/auth", label: "feature/auth" }],
          },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText("Search branches");
    expect(input).toHaveValue("feature");

    fireEvent.change(input, { target: { value: "feature/auth" } });

    expect(onSearchValueChange).toHaveBeenCalledWith("feature/auth");
    expect(input).toHaveValue("feature");
  });

  it("renders the create action from the current query when enabled", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        searchable
        searchPlaceholder="Search branches"
        sections={[{ kind: "options", id: "branches", items: [] }]}
        create={{
          visible: true,
          label: () => "Create branch",
          description: (query) => query,
          onCreate,
        }}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "feature/mobile-select" },
    });
    expect(screen.getByRole("button", { name: "Create branch" })).toHaveAccessibleDescription(
      "feature/mobile-select"
    );
    await user.click(screen.getByRole("button", { name: "Create branch" }));

    expect(onCreate).toHaveBeenCalledWith("feature/mobile-select");
  });

  it("renders the empty state through the shared primitive while preserving the feature shell hook", () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        sections={[{ kind: "options", id: "branches", items: [] }]}
        emptyText="No branches found"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const emptyState = document.querySelector(".mobile-select-sheet__empty");
    const emptyStateStyle = emptyState?.getAttribute("style") ?? "";
    const emptyStateTitleStyle = emptyState?.firstElementChild?.getAttribute("style") ?? "";

    expect(emptyState).not.toBeNull();
    expect(emptyState).toHaveTextContent("No branches found");
    expect(emptyStateStyle).toContain("min-height: auto");
    expect(emptyStateStyle).toContain("padding: var(--sp-6) var(--sp-4)");
    expect(emptyStateStyle).toContain("gap: 0");
    expect(emptyState?.childElementCount).toBe(1);
    expect(emptyState?.firstElementChild).toHaveTextContent("No branches found");
    expect(emptyState?.firstElementChild?.tagName).toBe("DIV");
    expect(emptyStateTitleStyle).toContain("color: var(--text-tertiary)");
    expect(emptyStateTitleStyle).toContain("font-weight: var(--font-normal)");
  });

  it("keeps the sheet open when closeOnSelect is false", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: "options",
            id: "terminals",
            items: [{ id: "term_1", label: "Workspace Shell" }],
          },
        ]}
        closeOnSelect={false}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole("button", { name: "Workspace Shell" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("represents disabled option, action, and create rows through the public API", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onAction = vi.fn();
    const onCreate = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        searchable
        searchPlaceholder="Search branches"
        sections={[
          {
            kind: "actions",
            id: "actions",
            items: [
              {
                id: "refresh",
                label: "Refresh",
                disabled: true,
                onAction,
              },
            ],
          },
          {
            kind: "options",
            id: "branches",
            items: [
              {
                id: "main",
                label: "main",
                description: "Protected branch",
                disabled: true,
              },
            ],
          },
        ]}
        create={{
          visible: true,
          label: () => "Create branch",
          description: (query) => query,
          disabled: (query) => query.includes("main"),
          onCreate,
        }}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "main" },
    });

    const option = screen.getByRole("button", { name: "main" });
    const action = screen.getByRole("button", { name: "Refresh" });
    const create = screen.getByRole("button", { name: "Create branch" });

    expect(option).toBeDisabled();
    expect(option).toHaveAccessibleDescription("Protected branch");
    expect(action).toBeDisabled();
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription("main");

    await user.click(option);
    await user.click(action);
    await user.click(create);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("renders the loading state through the shared primitive while preserving the feature shell hook", () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        loading
        sections={[{ kind: "options", id: "branches", items: [] }]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const loadingState = document.querySelector(".mobile-select-sheet__loading");

    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
    expect(loadingState).not.toBeNull();
    expect(loadingState).toHaveAttribute("role", "status");
    expect(loadingState).toHaveTextContent("Loading...");
    expect(document.querySelector(".mobile-select-sheet__empty")).toBeNull();
  });
});
