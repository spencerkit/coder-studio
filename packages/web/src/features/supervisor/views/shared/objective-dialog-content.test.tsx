import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectiveDialogContent } from "./objective-dialog-content";

vi.mock("../../../../lib/i18n", () => ({
  formatDate: (ts: number) => new Date(ts).toLocaleDateString(),
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
  it("does not render the supervisor intro strip by default for enable and edit modes", () => {
    const { rerender } = render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective="Investigate regressions"
        draftEvaluatorProviderId="claude"
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    expect(document.querySelector(".supervisor-dialog-intro")).toBeNull();

    rerender(
      <ObjectiveDialogContent
        mode="edit"
        draftObjective="Investigate regressions"
        draftEvaluatorProviderId="claude"
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    expect(document.querySelector(".supervisor-dialog-intro")).toBeNull();
  });

  it("renders a flat supervisor intro strip when showIntro is true for enable and edit modes", () => {
    const { rerender } = render(
      <ObjectiveDialogContent
        mode="enable"
        showIntro
        draftObjective="Investigate regressions"
        draftEvaluatorProviderId="claude"
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    let intro = document.querySelector(".supervisor-dialog-intro");
    let introIcon = document.querySelector(".supervisor-dialog-intro__icon");
    let introCopy = document.querySelector(".supervisor-dialog-intro__copy");
    let firstFormGroup = document.querySelector(".form-group");
    expect(intro).toBeTruthy();
    expect(introIcon).toBeTruthy();
    expect(introCopy).toBeTruthy();
    expect(intro?.querySelector(".supervisor-dialog-intro__icon")).toBe(introIcon);
    expect(intro?.querySelector(".supervisor-dialog-intro__copy")).toBe(introCopy);
    expect(introIcon?.querySelector('[data-icon-semantic="supervisor.mode.enable"]')).toBeTruthy();
    expect(firstFormGroup).toBeTruthy();
    expect(intro?.compareDocumentPosition(firstFormGroup as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(intro?.querySelector(".supervisor-dialog-intro__title")).toHaveTextContent(
      "supervisor.dialog.enable.title"
    );
    expect(intro?.querySelector(".supervisor-dialog-intro__description")).toHaveTextContent(
      "supervisor.dialog.enable.subtitle"
    );

    rerender(
      <ObjectiveDialogContent
        mode="edit"
        showIntro
        draftObjective="Investigate regressions"
        draftEvaluatorProviderId="claude"
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    intro = document.querySelector(".supervisor-dialog-intro");
    introIcon = document.querySelector(".supervisor-dialog-intro__icon");
    introCopy = document.querySelector(".supervisor-dialog-intro__copy");
    firstFormGroup = document.querySelector(".form-group");
    expect(intro).toBeTruthy();
    expect(introIcon).toBeTruthy();
    expect(introCopy).toBeTruthy();
    expect(intro?.querySelector(".supervisor-dialog-intro__icon")).toBe(introIcon);
    expect(intro?.querySelector(".supervisor-dialog-intro__copy")).toBe(introCopy);
    expect(introIcon?.querySelector('[data-icon-semantic="supervisor.mode.edit"]')).toBeTruthy();
    expect(firstFormGroup).toBeTruthy();
    expect(intro?.compareDocumentPosition(firstFormGroup as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(intro?.querySelector(".supervisor-dialog-intro__title")).toHaveTextContent(
      "supervisor.dialog.edit.title"
    );
    expect(intro?.querySelector(".supervisor-dialog-intro__description")).toHaveTextContent(
      "supervisor.dialog.edit.subtitle"
    );
  });

  it("renders compact control classes instead of large form controls", () => {
    render(
      <ObjectiveDialogContent
        mode="edit"
        draftObjective="Investigate regressions"
        draftEvaluatorProviderId="claude"
        draftEvaluatorModel="sonnet"
        draftMaxSupervisionCount="3"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText("supervisor.field.objective");
    expect(textarea).toHaveClass("input", "textarea");
    expect(textarea).not.toHaveClass("textarea-lg");
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
    expect(trigger).toHaveClass("input", "mobile-select-trigger", "input-sm");
    expect(trigger).toHaveAttribute("aria-describedby");
    expect(screen.getByText("supervisor.field.evaluator_helper")).toHaveAttribute(
      "id",
      trigger.getAttribute("aria-describedby")
    );

    expect(screen.getByLabelText("supervisor.field.evaluator_model")).toHaveClass(
      "input",
      "input-sm"
    );
    expect(screen.getByLabelText("supervisor.field.max_supervision_count")).toHaveClass(
      "input",
      "input-sm"
    );
    expect(screen.getByRole("button", { name: "supervisor.field.scheduled_at" })).toHaveClass(
      "input",
      "input-sm"
    );
  });

  it("keeps objective editing behavior unchanged", () => {
    const onDraftObjectiveChange = vi.fn();

    render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective=""
        draftEvaluatorProviderId="heuristic"
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={onDraftObjectiveChange}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
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
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={onDraftEvaluatorProviderChange}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
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
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={onDraftEvaluatorProviderChange}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "supervisor.field.evaluator Codex",
    });
    expect(trigger).toHaveClass("input", "mobile-select-trigger", "input-sm");
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

  it("renders and edits evaluator model, max supervision count, and schedule fields", () => {
    const onDraftEvaluatorModelChange = vi.fn();
    const onDraftMaxSupervisionCountChange = vi.fn();
    const onDraftScheduledAtChange = vi.fn();

    render(
      <ObjectiveDialogContent
        mode="enable"
        draftObjective=""
        draftEvaluatorProviderId="codex"
        draftEvaluatorModel="o3"
        draftMaxSupervisionCount="5"
        draftScheduledAt="2026-05-11T03:00"
        disableObjective=""
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={onDraftEvaluatorModelChange}
        onDraftMaxSupervisionCountChange={onDraftMaxSupervisionCountChange}
        onDraftScheduledAtChange={onDraftScheduledAtChange}
      />
    );

    fireEvent.change(screen.getByLabelText("supervisor.field.evaluator_model"), {
      target: { value: "gpt-5" },
    });
    fireEvent.change(screen.getByLabelText("supervisor.field.max_supervision_count"), {
      target: { value: "8" },
    });

    expect(onDraftEvaluatorModelChange).toHaveBeenCalledWith("gpt-5");
    expect(onDraftMaxSupervisionCountChange).toHaveBeenCalledWith("8");
  });

  it("renders the semantic warning icon for disable mode", () => {
    render(
      <ObjectiveDialogContent
        mode="disable"
        showIntro
        draftObjective=""
        draftEvaluatorProviderId="codex"
        draftEvaluatorModel=""
        draftMaxSupervisionCount="0"
        draftScheduledAt=""
        disableObjective="Current objective"
        onDraftObjectiveChange={vi.fn()}
        onDraftEvaluatorProviderChange={vi.fn()}
        onDraftEvaluatorModelChange={vi.fn()}
        onDraftMaxSupervisionCountChange={vi.fn()}
        onDraftScheduledAtChange={vi.fn()}
      />
    );

    expect(document.querySelector(".supervisor-dialog-intro")).toBeNull();
    expect(
      screen.getByRole("alert").querySelector('[data-icon-semantic="state.warning"]')
    ).toBeTruthy();
  });
});
