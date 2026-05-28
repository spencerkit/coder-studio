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
  },
}));

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
      expect.objectContaining({
        tokenizer: expect.objectContaining({
          root: expect.arrayContaining([
            [/\{\{|\}\}/, "delimiter.bracket"],
            [/v-[\w-]+|:[\w-]+|@[\w-]+/, "attribute.name"],
            [/<!--/, "comment", "@comment"],
          ]),
        }),
      })
    );
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
