import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ObjectiveDialogContent } from "./objective-dialog-content";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => key,
}));

describe("ObjectiveDialogContent", () => {
  it("renders shared textarea and desktop select primitives with helper text wiring", () => {
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

    const select = screen.getByRole("combobox", { name: "supervisor.field.evaluator" });
    expect(select).toHaveClass("input");
    expect(select).toHaveValue("claude");
    expect(select).toHaveAttribute("aria-describedby");
    expect(screen.getByText("supervisor.field.evaluator_helper")).toHaveAttribute(
      "id",
      select.getAttribute("aria-describedby")
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

  it("keeps evaluator selection behavior unchanged on desktop", () => {
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

    fireEvent.change(screen.getByRole("combobox", { name: "supervisor.field.evaluator" }), {
      target: { value: "codex" },
    });

    expect(onDraftEvaluatorProviderChange).toHaveBeenCalledWith("codex");
  });

  it("renders the mobile evaluator trigger with dialog semantics", () => {
    const onOpen = vi.fn();

    render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective=""
        draftEvaluatorProviderId="codex"
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        mobileEvaluatorPicker={{
          isMobile: true,
          onOpen,
        }}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "supervisor.field.evaluator Codex",
    });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-describedby");

    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
