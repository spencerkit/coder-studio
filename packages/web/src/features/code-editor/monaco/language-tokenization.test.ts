import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { originalMatchMedia } = vi.hoisted(() => {
  const viewportQuery = "(max-width: 899px), (pointer: coarse)";
  const originalMatchMedia = window.matchMedia;

  const applyMatchMedia = (device: "desktop" | "mobile") => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query === viewportQuery ? device === "mobile" : false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => true,
      }),
    });
  };

  applyMatchMedia("desktop");
  return { originalMatchMedia };
});

import * as monaco from "monaco-editor";

import { ensureVueLanguageRegistered } from "./vue-language";

const samples = [
  { languageId: "python", source: "def main():\n    return 1\n" },
  { languageId: "go", source: "package main\nfunc main() {}\n" },
  { languageId: "rust", source: "fn main() {\n    let value = 1;\n}\n" },
  {
    languageId: "vue",
    source: '<template><button @click="count++">{{ count }}</button></template>\n',
  },
] as const;

describe("Monaco language tokenization", () => {
  beforeAll(() => {
    ensureVueLanguageRegistered();
  });

  it.each(samples)("tokenizes $languageId code with non-plaintext tokens", async ({
    languageId,
    source,
  }) => {
    await monaco.editor.colorize(source, languageId, {});

    const tokens = monaco.editor.tokenize(source, languageId).flat();

    expect(tokens.some((token) => token.type && token.type !== "source")).toBe(true);
  });
});

afterAll(() => {
  if (originalMatchMedia) {
    window.matchMedia = originalMatchMedia;
  } else {
    delete (window as typeof window & { matchMedia?: typeof window.matchMedia }).matchMedia;
  }
});
