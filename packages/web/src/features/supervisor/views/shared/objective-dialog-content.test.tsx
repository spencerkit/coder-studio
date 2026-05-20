import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
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

type ObjectiveDialogContentProps = ComponentProps<typeof ObjectiveDialogContent>;

function createObjectiveDialogContentProps(
  overrides: Partial<ObjectiveDialogContentProps> = {}
): ObjectiveDialogContentProps {
  return {
    mode: "enable",
    restoreStep: "form",
    draftObjective: "Investigate regressions",
    draftEvaluatorProviderId: "claude",
    draftEvaluatorModel: "",
    draftMaxSupervisionCount: "0",
    draftScheduledAt: "",
    isMaxSupervisionCountValid: true,
    recoverableTargets: [],
    selectedRecoverableTargetId: null,
    isRecoverableTargetsLoading: false,
    onDraftObjectiveChange: vi.fn(),
    onDraftEvaluatorProviderChange: vi.fn(),
    onDraftEvaluatorModelChange: vi.fn(),
    onDraftMaxSupervisionCountChange: vi.fn(),
    onDraftScheduledAtChange: vi.fn(),
    onOpenRestoreStep: vi.fn(),
    onCloseRestoreStep: vi.fn(),
    onSelectRecoverableTarget: vi.fn(),
    ...overrides,
  };
}

function renderObjectiveDialogContent(overrides: Partial<ObjectiveDialogContentProps> = {}) {
  return render(<ObjectiveDialogContent {...createObjectiveDialogContentProps(overrides)} />);
}

describe("ObjectiveDialogContent", () => {
  it("renders the max supervision count field as valid by default in shared-content tests", () => {
    renderObjectiveDialogContent();

    expect(screen.getByLabelText("supervisor.field.max_supervision_count")).toHaveAttribute(
      "aria-invalid",
      "false"
    );
  });

  it("does not render the supervisor intro strip by default for enable and edit modes", () => {
    const { rerender } = renderObjectiveDialogContent();

    expect(document.querySelector(".supervisor-dialog-intro")).toBeNull();

    rerender(<ObjectiveDialogContent {...createObjectiveDialogContentProps({ mode: "edit" })} />);

    expect(document.querySelector(".supervisor-dialog-intro")).toBeNull();
  });

  it("renders a flat supervisor intro strip when showIntro is true for enable and edit modes", () => {
    const { rerender } = renderObjectiveDialogContent({ showIntro: true });

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
        {...createObjectiveDialogContentProps({ mode: "edit", showIntro: true })}
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
    renderObjectiveDialogContent({
      mode: "edit",
      draftEvaluatorModel: "sonnet",
      draftMaxSupervisionCount: "3",
    });

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

    renderObjectiveDialogContent({
      draftObjective: "",
      draftEvaluatorProviderId: "heuristic",
      onDraftObjectiveChange,
    });

    const textarea = screen.getByLabelText("supervisor.field.objective");
    fireEvent.change(textarea, { target: { value: "Ship a safe rollout plan" } });

    expect(onDraftObjectiveChange).toHaveBeenCalledWith("Ship a safe rollout plan");
    expect(textarea).toHaveAttribute("placeholder", "supervisor.field.objective_placeholder");
  });

  it("keeps evaluator selection behavior unchanged on desktop", async () => {
    const user = userEvent.setup();
    const onDraftEvaluatorProviderChange = vi.fn();

    renderObjectiveDialogContent({
      draftObjective: "",
      onDraftEvaluatorProviderChange,
    });

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

    renderObjectiveDialogContent({
      draftObjective: "",
      draftEvaluatorProviderId: "codex",
      onDraftEvaluatorProviderChange,
    });

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

    renderObjectiveDialogContent({
      draftObjective: "",
      draftEvaluatorProviderId: "codex",
      draftEvaluatorModel: "o3",
      draftMaxSupervisionCount: "5",
      draftScheduledAt: "2026-05-11T03:00",
      onDraftEvaluatorModelChange,
      onDraftMaxSupervisionCountChange,
      onDraftScheduledAtChange,
    });

    fireEvent.change(screen.getByLabelText("supervisor.field.evaluator_model"), {
      target: { value: "gpt-5" },
    });
    fireEvent.change(screen.getByLabelText("supervisor.field.max_supervision_count"), {
      target: { value: "8" },
    });

    expect(onDraftEvaluatorModelChange).toHaveBeenCalledWith("gpt-5");
    expect(onDraftMaxSupervisionCountChange).toHaveBeenCalledWith("8");
  });

  it("shows a restore entry on the enable form and keeps it out of edit mode", async () => {
    const user = userEvent.setup();
    const onOpenRestoreStep = vi.fn();
    const { rerender } = renderObjectiveDialogContent({ onOpenRestoreStep });

    await user.click(screen.getByRole("button", { name: "supervisor.dialog.restore.open" }));

    expect(onOpenRestoreStep).toHaveBeenCalledTimes(1);

    rerender(
      <ObjectiveDialogContent
        {...createObjectiveDialogContentProps({ mode: "edit", onOpenRestoreStep })}
      />
    );

    expect(
      screen.queryByRole("button", { name: "supervisor.dialog.restore.open" })
    ).not.toBeInTheDocument();
  });

  it("renders the restore subview with recoverable targets, selection, and back navigation", async () => {
    const user = userEvent.setup();
    const onCloseRestoreStep = vi.fn();
    const onSelectRecoverableTarget = vi.fn();

    renderObjectiveDialogContent({
      mode: "enable",
      restoreStep: "restore",
      recoverableTargets: [
        {
          targetId: "tgt-restore",
          sessionId: "sess-old",
          workspaceId: "ws-1",
          objective: "Recover the rollout supervisor",
          status: "active",
          updatedAt: 1_746_000_000_000,
          progressSummary: "Need to finish rollout verification",
          cycleCount: 4,
        },
      ],
      selectedRecoverableTargetId: "tgt-restore",
      onCloseRestoreStep,
      onSelectRecoverableTarget,
    });

    expect(screen.getByText("supervisor.dialog.restore.title")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Recover the rollout supervisor/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("Need to finish rollout verification")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Recover the rollout supervisor/i }));

    expect(onSelectRecoverableTarget).toHaveBeenCalledWith("tgt-restore");

    await user.click(screen.getByRole("button", { name: "supervisor.dialog.restore.back" }));

    expect(onCloseRestoreStep).toHaveBeenCalledTimes(1);
  });

  it("renders loading and empty restore states through the shared restore shell", () => {
    const { rerender } = renderObjectiveDialogContent({
      mode: "enable",
      restoreStep: "restore",
      isRecoverableTargetsLoading: true,
    });

    expect(screen.getByLabelText("common.loading")).toBeInTheDocument();

    rerender(
      <ObjectiveDialogContent
        {...createObjectiveDialogContentProps({
          mode: "enable",
          restoreStep: "restore",
          recoverableTargets: [],
          isRecoverableTargetsLoading: false,
        })}
      />
    );

    expect(screen.getByText("supervisor.dialog.restore.empty")).toBeInTheDocument();
  });
});
