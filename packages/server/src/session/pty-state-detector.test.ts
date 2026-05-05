import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyStateDetector } from "./pty-state-detector.js";

describe("PtyStateDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits running on first output", () => {
    const onStateChange = vi.fn();
    const detector = new PtyStateDetector({
      heuristics: { idlePromptPatterns: [], idleDebounceMs: 3000 },
      onStateChange,
    });

    detector.feed(Buffer.from("hello", "utf8"));

    expect(onStateChange).toHaveBeenCalledWith("running");
  });

  it("emits idle after the debounce window elapses without output", () => {
    const onStateChange = vi.fn();
    const detector = new PtyStateDetector({
      heuristics: { idlePromptPatterns: [], idleDebounceMs: 3000 },
      onStateChange,
    });

    detector.feed(Buffer.from("hello", "utf8"));
    onStateChange.mockClear();

    vi.advanceTimersByTime(2999);
    expect(onStateChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onStateChange).toHaveBeenCalledWith("idle");
  });

  it("resets the idle debounce when more output arrives", () => {
    const onStateChange = vi.fn();
    const detector = new PtyStateDetector({
      heuristics: { idlePromptPatterns: [], idleDebounceMs: 3000 },
      onStateChange,
    });

    detector.feed(Buffer.from("a", "utf8"));
    vi.advanceTimersByTime(2000);
    detector.feed(Buffer.from("b", "utf8"));
    onStateChange.mockClear();

    vi.advanceTimersByTime(2000);
    expect(onStateChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onStateChange).toHaveBeenCalledWith("idle");
  });

  it("emits idle immediately when a prompt pattern matches", () => {
    const onStateChange = vi.fn();
    const detector = new PtyStateDetector({
      heuristics: { idlePromptPatterns: [/\n>\s*$/], idleDebounceMs: 60000 },
      onStateChange,
    });

    detector.feed(Buffer.from("output\n> ", "utf8"));

    expect(onStateChange).toHaveBeenNthCalledWith(1, "running");
    expect(onStateChange).toHaveBeenNthCalledWith(2, "idle");
  });

  it("debounces duplicate state emissions", () => {
    const onStateChange = vi.fn();
    const detector = new PtyStateDetector({
      heuristics: { idlePromptPatterns: [], idleDebounceMs: 1000 },
      onStateChange,
    });

    detector.feed(Buffer.from("a", "utf8"));
    detector.feed(Buffer.from("b", "utf8"));

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith("running");
  });
});
