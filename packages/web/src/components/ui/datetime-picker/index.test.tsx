import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { formatDate } from "../../../lib/i18n";
import { DateTimePicker } from "..";

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

function renderWithLocale(node: ReactNode, locale: "en" | "zh" = "en") {
  window.localStorage.setItem("ui.locale", JSON.stringify(locale));

  const store = createStore();
  store.set(localeAtom, locale);

  return {
    store,
    ...render(<Provider store={store}>{node}</Provider>),
  };
}

describe("DateTimePicker", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.localStorage.removeItem("ui.locale");
    vi.useRealTimers();
  });

  it("renders the trigger button with label and placeholder", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker
        value=""
        onValueChange={vi.fn()}
        label="Scheduled At"
        placeholder="Select date and time"
      />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Select date and time");
  });

  it("renders the current value formatted according to locale", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="2026-05-11T14:30" onValueChange={vi.fn()} label="Scheduled At" />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toHaveTextContent("May");
  });

  it("opens desktop popover on trigger click", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Scheduled At" });
    expect(dialog).toBeInTheDocument();
  });

  it("calls onValueChange when confirm button is clicked", () => {
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();

    renderWithLocale(
      <DateTimePicker
        value="2026-05-11T14:30"
        onValueChange={onValueChange}
        label="Scheduled At"
      />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    fireEvent.click(confirmButton);

    expect(onValueChange).toHaveBeenCalledWith("2026-05-11T14:30");
  });

  it("calls onValueChange with empty string when clear button is clicked", () => {
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();

    renderWithLocale(
      <DateTimePicker
        value="2026-05-11T14:30"
        onValueChange={onValueChange}
        label="Scheduled At"
        clearable
      />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const clearButton = screen.getByRole("button", { name: "Clear" });
    fireEvent.click(clearButton);

    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("applies invalid styling when invalid prop is true", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" invalid />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toHaveClass("input-invalid");
  });

  it("supports disabled state", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" disabled />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toBeDisabled();
  });

  it("opens mobile sheet on trigger click", () => {
    setMatchMediaMock(
      (query) => query.includes("max-width: 899px") || query.includes("pointer: coarse")
    );

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" />,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const region = screen.getByRole("region", { name: /Scheduled At/ });
    expect(region).toBeInTheDocument();
  });

  it("links aria-describedby when provided", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <>
        <DateTimePicker
          value=""
          onValueChange={vi.fn()}
          label="Scheduled At"
          aria-describedby="helper"
        />
        <span id="helper">Select execution time</span>
      </>,
      "en"
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toHaveAttribute("aria-describedby", "helper");
  });

  it("defaults a blank draft to the current minute when minDate is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T14:37:00"));
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();

    renderWithLocale(
      <DateTimePicker
        value=""
        onValueChange={onValueChange}
        label="Scheduled At"
        minDate={new Date()}
      />,
      "en"
    );

    fireEvent.click(screen.getByRole("button", { name: "Scheduled At" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onValueChange).toHaveBeenCalledWith("2026-05-12T14:37");
  });

  it("disables confirmation for past times on the current day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T14:37:00"));
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" minDate={new Date()} />,
      "en"
    );

    fireEvent.click(screen.getByRole("button", { name: "Scheduled At" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Hour" }), {
      target: { value: "09" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minute" }), {
      target: { value: "00" },
    });

    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("preserves an in-progress draft across parent rerenders while open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T14:37:00"));
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();
    const view = renderWithLocale(
      <DateTimePicker
        value=""
        onValueChange={onValueChange}
        label="Scheduled At"
        minDate={new Date()}
      />,
      "en"
    );

    fireEvent.click(screen.getByRole("button", { name: "Scheduled At" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minute" }), {
      target: { value: "45" },
    });

    vi.setSystemTime(new Date("2026-05-12T14:38:00"));
    view.rerender(
      <Provider store={view.store}>
        <DateTimePicker
          value=""
          onValueChange={onValueChange}
          label="Scheduled At"
          minDate={new Date()}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onValueChange).toHaveBeenCalledWith("2026-05-12T14:45");
  });

  it("clamps the selected day when navigating to a shorter month", () => {
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();

    renderWithLocale(
      <DateTimePicker
        value="2026-01-31T14:30"
        onValueChange={onValueChange}
        label="Scheduled At"
      />,
      "en"
    );

    fireEvent.click(screen.getByRole("button", { name: "Scheduled At" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Month" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onValueChange).toHaveBeenCalledWith("2026-02-28T14:30");
  });

  it("highlights the in-progress draft selection in the calendar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:00"));
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" />,
      "en"
    );

    fireEvent.click(screen.getByRole("button", { name: "Scheduled At" }));
    fireEvent.click(screen.getByRole("button", { name: "20" }));

    expect(screen.getByRole("button", { name: "20" }).className).toContain("calendarDaySelected");
  });

  it("formats the trigger value using the active locale", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="2026-05-11T14:30" onValueChange={vi.fn()} label="Scheduled At" />,
      "zh"
    );

    expect(screen.getByRole("button", { name: "Scheduled At" })).toHaveTextContent(
      formatDate(new Date(2026, 4, 11, 14, 30).getTime(), "zh")
    );
  });

  it("localizes and labels the time inputs for accessibility", () => {
    setMatchMediaMock(() => false);

    renderWithLocale(
      <DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" />,
      "zh"
    );

    fireEvent.click(screen.getByRole("button", { name: "Scheduled At" }));

    expect(screen.getByRole("spinbutton", { name: "小时" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "分钟" })).toBeInTheDocument();
  });
});

describe("DateTimePicker popover rendering", () => {
  it("renders desktop popover content when viewport is desktop", () => {
    setMatchMediaMock(() => false);

    render(
      <DateTimePicker value="2026-05-11T14:30" onValueChange={vi.fn()} label="Scheduled At" />
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Scheduled At" });
    expect(dialog).toBeInTheDocument();

    // Verify popover content is rendered
    expect(dialog.className).toContain("content");
  });
});
