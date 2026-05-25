import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegisterLanguage, mockSetLanguageConfiguration, mockSetMonarchTokensProvider } =
  vi.hoisted(() => ({
    mockRegisterLanguage: vi.fn(),
    mockSetLanguageConfiguration: vi.fn(),
    mockSetMonarchTokensProvider: vi.fn(),
  }));

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
        comments: expect.any(Object),
        brackets: expect.any(Array),
        autoClosingPairs: expect.any(Array),
      })
    );
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
      "vue",
      expect.objectContaining({
        tokenizer: expect.any(Object),
      })
    );
  });
});
