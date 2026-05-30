import { beforeAll, describe, expect, it } from "vitest";

const samples = [
  { languageId: "python", source: "def main():\n    return 1\n" },
  { languageId: "go", source: "package main\nfunc main() {}\n" },
  { languageId: "rust", source: "fn main() {\n    let value = 1;\n}\n" },
  {
    languageId: "vue",
    source: '<template><button @click="count++">{{ count }}</button></template>\n',
  },
] as const;

let monaco: typeof import("monaco-editor");
let ensureVueLanguageRegistered: typeof import("./vue-language").ensureVueLanguageRegistered;

describe("Monaco language tokenization", () => {
  it.each(samples)("tokenizes $languageId code with non-plaintext tokens", async ({
    languageId,
    source,
  }) => {
    await monaco.editor.colorize(source, languageId, {});

    const tokens = monaco.editor.tokenize(source, languageId).flat();

    expect(tokens.some((token) => token.type && token.type !== "source")).toBe(true);
  });
});

beforeAll(async () => {
  window.matchMedia ??= () =>
    ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;

  monaco = await import("monaco-editor");
  ({ ensureVueLanguageRegistered } = await import("./vue-language"));
  ensureVueLanguageRegistered();
});
