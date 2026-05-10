import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectiveDialogContent } from "./objective-dialog-content";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => key,
}));

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: predicate(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

afterEach(() => {
  delete (window as typeof window & { matchMedia?: typeof window.matchMedia }).matchMedia;
});

describe("ObjectiveDialogContent", () => {
  it("renders shared textarea and desktop select trigger primitives with helper text wiring", () => {
    render(
      <ObjectiveDialogContent
        mode="edit"
        draftObjective="Investigate regressions"
        draftEvaluatorProviderId="claude"
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText("supervisor.field.objective");
    expect(textarea).toHaveClass("input", "textarea", "textarea-lg");
    expect(textarea).toHaveAttribute("rows", "5");
    expect(textarea).toHaveValue("Investigate regressions");
    expect(textarea).toHaveAttribute("aria-describedby");
    expect(screen.getByText("supervisor.field.objective_helper")).toHaveAttribute(
      "id",
      textarea.getAttribute("aria-describedby")
    );

    const trigger = screen.getByRole("button", {
      name: "supervisor.field.evaluator Claude",
    });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger).toHaveAttribute("aria-describedby");
    expect(screen.getByText("supervisor.field.evaluator_helper")).toHaveAttribute(
      "id",
      trigger.getAttribute("aria-describedby")
    );
  });

  it("keeps objective editing behavior unchanged", () => {
    const onDraftObjectiveChange = vi.fn();

    render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective=""
        draftEvaluatorProviderId="heuristic"
        disableObjective=""
        onDraftObjectiveChange={onDraftObjectiveChange}
        onDraftEvaluatorProviderChange={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText("supervisor.field.objective");
    fireEvent.change(textarea, { target: { value: "Ship a safe rollout plan" } });

    expect(onDraftObjectiveChange).toHaveBeenCalledWith("Ship a safe rollout plan");
    expect(textarea).toHaveAttribute("placeholder", "supervisor.field.objective_placeholder");
  });

  it("keeps evaluator selection behavior unchanged on desktop", async () => {
    const user = userEvent.setup();
    const onDraftEvaluatorProviderChange = vi.fn();

    render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective=""
        draftEvaluatorProviderId="claude"
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={onDraftEvaluatorProviderChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "supervisor.field.evaluator Claude" }));

    const listbox = screen.getByRole("listbox", { name: "supervisor.field.evaluator" });
    expect(within(listbox).getByRole("option", { name: "Claude" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await user.click(within(listbox).getByRole("option", { name: "Codex" }));

    expect(onDraftEvaluatorProviderChange).toHaveBeenCalledWith("codex");
  });

  it("renders the mobile evaluator trigger with an inline sheet owned by the shared select", async () => {
    const user = userEvent.setup();
    const onDraftEvaluatorProviderChange = vi.fn();
    setMatchMediaMock(
      (query) => query.includes("max-width: 899px") || query.includes("pointer: coarse")
    );

    render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective=""
        draftEvaluatorProviderId="codex"
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={onDraftEvaluatorProviderChange}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "supervisor.field.evaluator Codex",
    });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-describedby");

    await user.click(trigger);

    await waitFor(() => {
      expect(document.querySelector(".mobile-inline-sheet")).toBeTruthy();
    });
    expect(document.querySelector(".mobile-inline-sheet .page-header__title")).toHaveTextContent(
      "supervisor.field.evaluator"
    );

    await user.click(screen.getByRole("button", { name: "Codex" }));
    expect(onDraftEvaluatorProviderChange).toHaveBeenCalledWith("codex");
  });
});
