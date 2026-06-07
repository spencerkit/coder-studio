import { describe, expect, it } from "vitest";
import {
  containsOsc11BackgroundQuery,
  formatOsc11BackgroundResponse,
  shouldInjectOsc11BackgroundResponse,
} from "./osc-theme-response";

describe("osc-theme-response", () => {
  describe("formatOsc11BackgroundResponse", () => {
    it("encodes light mint background using X11 rgb notation", () => {
      expect(formatOsc11BackgroundResponse("#fcfffd")).toBe("\x1b]11;rgb:fcfc/ffff/fdfd\x1b\\");
    });

    it("encodes dark mint background using X11 rgb notation", () => {
      expect(formatOsc11BackgroundResponse("#0b1218")).toBe("\x1b]11;rgb:0b0b/1212/1818\x1b\\");
    });

    it("accepts #RRGGBBAA and ignores the alpha channel", () => {
      expect(formatOsc11BackgroundResponse("#fcfffd80")).toBe("\x1b]11;rgb:fcfc/ffff/fdfd\x1b\\");
    });

    it("returns null for malformed colors", () => {
      expect(formatOsc11BackgroundResponse("not-a-color")).toBeNull();
    });
  });

  describe("containsOsc11BackgroundQuery", () => {
    it("detects ESC \\ terminated OSC 11 queries", () => {
      expect(containsOsc11BackgroundQuery("\x1b]11;?\x1b\\")).toBe(true);
    });

    it("detects BEL terminated OSC 11 queries", () => {
      expect(containsOsc11BackgroundQuery("\x1b]11;?\x07")).toBe(true);
    });

    it("detects OSC 11 queries embedded in startup capability batches", () => {
      const batch = `\x1b[?25l\x1b]11;?\x1b\\\x1b[c`;
      expect(containsOsc11BackgroundQuery(batch)).toBe(true);
    });

    it("ignores unrelated output", () => {
      expect(containsOsc11BackgroundQuery("hello from gemini\n")).toBe(false);
    });
  });

  describe("shouldInjectOsc11BackgroundResponse", () => {
    it("enables injection only on Windows", () => {
      expect(shouldInjectOsc11BackgroundResponse("win32")).toBe(true);
      expect(shouldInjectOsc11BackgroundResponse("darwin")).toBe(false);
      expect(shouldInjectOsc11BackgroundResponse("linux")).toBe(false);
    });
  });
});
