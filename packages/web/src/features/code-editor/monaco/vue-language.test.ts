import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegisterLanguage, mockSetLanguageConfiguration, mockSetMonarchTokensProvider } =
  vi.hoisted(() => ({
    mockRegisterLanguage: vi.fn(),
    mockSetLanguageConfiguration: vi.fn(),
    mockSetMonarchTokensProvider: vi.fn(),
  }));

const VUE_LANGUAGE_REGISTERED_KEY = Symbol.for("coder-studio.monaco.vue-language.registered");

vi.mock("monaco-editor", () => ({
  languages: {
    register: mockRegisterLanguage,
    setLanguageConfiguration: mockSetLanguageConfiguration,
    setMonarchTokensProvider: mockSetMonarchTokensProvider,
    IndentAction: { Indent: 1, IndentOutdent: 2 },
  },
}));

interface MonarchProvider {
  tokenizer: {
    root: Array<unknown>;
    templateBlock?: Array<unknown>;
    tagAttributes?: Array<unknown>;
    scriptTsEmbedded?: Array<unknown>;
    scriptJsEmbedded?: Array<unknown>;
    styleCssEmbedded?: Array<unknown>;
    styleScssEmbedded?: Array<unknown>;
    [state: string]: Array<unknown> | undefined;
  };
}

function getRegisteredProvider(): MonarchProvider {
  const lastCall = mockSetMonarchTokensProvider.mock.calls.at(-1);
  expect(lastCall?.[0]).toBe("vue");
  return lastCall?.[1] as MonarchProvider;
}

function stringifyRules(rules: Array<unknown> | undefined): string {
  return rules
    ? JSON.stringify(rules, (_, value) => (value instanceof RegExp ? value.source : value))
    : "";
}

describe("ensureVueLanguageRegistered", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRegisterLanguage.mockClear();
    mockSetLanguageConfiguration.mockClear();
    mockSetMonarchTokensProvider.mockClear();
    delete (globalThis as Record<PropertyKey, unknown>)[VUE_LANGUAGE_REGISTERED_KEY];
  });

  it("registers the vue language exactly once", async () => {
    const monaco = await import("monaco-editor");
    const { ensureVueLanguageRegistered } = await import("./vue-language");

    ensureVueLanguageRegistered();
    ensureVueLanguageRegistered();

    expect(monaco.languages.register).toHaveBeenCalledWith({ id: "vue" });
    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith(
      "vue",
      expect.objectContaining({
        comments: { blockComment: ["<!--", "-->"] },
        brackets: expect.arrayContaining([
          ["<", ">"],
          ["{", "}"],
        ]),
        autoClosingPairs: expect.arrayContaining([{ open: "{", close: "}" }]),
      })
    );
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
      "vue",
      expect.any(Object)
    );
  });

  it("delegates <script> contents to typescript or javascript based on lang attribute", async () => {
    const { ensureVueLanguageRegistered } = await import("./vue-language");
    ensureVueLanguageRegistered();

    const provider = getRegisteredProvider();
    const rootSource = stringifyRules(provider.tokenizer.root);

    expect(rootSource).toContain("@scriptTsEmbedded");
    expect(rootSource).toContain("@scriptJsEmbedded");

    expect(stringifyRules(provider.tokenizer.scriptTsEmbedded)).toContain("typescript");
    expect(stringifyRules(provider.tokenizer.scriptJsEmbedded)).toContain("javascript");
  });

  it("delegates <style> contents to css / scss / less based on lang attribute", async () => {
    const { ensureVueLanguageRegistered } = await import("./vue-language");
    ensureVueLanguageRegistered();

    const provider = getRegisteredProvider();
    expect(stringifyRules(provider.tokenizer.styleCssEmbedded)).toContain("css");
    expect(stringifyRules(provider.tokenizer.styleScssEmbedded)).toContain("scss");
    expect(stringifyRules(provider.tokenizer.styleLessEmbedded)).toContain("less");
  });

  it("recognises vue directive shorthand and mustache interpolation in templates", async () => {
    const { ensureVueLanguageRegistered } = await import("./vue-language");
    ensureVueLanguageRegistered();

    const provider = getRegisteredProvider();
    const templateSource = stringifyRules(provider.tokenizer.templateBlock);
    const attributesSource = stringifyRules(provider.tokenizer.tagAttributes);

    expect(templateSource).toContain("\\\\{\\\\{"); // mustache opener
    expect(attributesSource).toContain("v-"); // v-bind/v-if/v-on
    expect(attributesSource).toContain("[:@#]"); // shorthand for bind/on/slot
  });

  it("does not register the vue language again after a fresh module import", async () => {
    const firstModule = await import("./vue-language");

    firstModule.ensureVueLanguageRegistered();
    expect(mockRegisterLanguage).toHaveBeenCalledTimes(1);

    vi.resetModules();

    const secondModule = await import("./vue-language");
    secondModule.ensureVueLanguageRegistered();

    expect(mockRegisterLanguage).toHaveBeenCalledTimes(1);
    expect(mockSetLanguageConfiguration).toHaveBeenCalledTimes(1);
    expect(mockSetMonarchTokensProvider).toHaveBeenCalledTimes(1);
  });
});
