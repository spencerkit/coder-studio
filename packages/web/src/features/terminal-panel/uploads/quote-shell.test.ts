import { describe, expect, it } from "vitest";
import { quoteShellSingle } from "./quote-shell.js";

describe("quoteShellSingle", () => {
  it("wraps simple strings in single quotes", () => {
    expect(quoteShellSingle("hello.png")).toBe("'hello.png'");
  });

  it("preserves spaces inside the quotes", () => {
    expect(quoteShellSingle("my file.png")).toBe("'my file.png'");
  });

  it("escapes embedded single quotes via close-escape-reopen", () => {
    expect(quoteShellSingle("it's.png")).toBe("'it'\\''s.png'");
  });

  it("handles empty string", () => {
    expect(quoteShellSingle("")).toBe("''");
  });

  it("preserves CJK characters verbatim", () => {
    expect(quoteShellSingle("截图.png")).toBe("'截图.png'");
  });
});
