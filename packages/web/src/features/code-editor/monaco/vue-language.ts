import * as monaco from "monaco-editor";

const VUE_LANGUAGE_REGISTERED_KEY = Symbol.for("coder-studio.monaco.vue-language.registered");

type VueLanguageRegistrationState = typeof globalThis & {
  [VUE_LANGUAGE_REGISTERED_KEY]?: boolean;
};

export function ensureVueLanguageRegistered(): void {
  const registrationState = globalThis as VueLanguageRegistrationState;
  if (registrationState[VUE_LANGUAGE_REGISTERED_KEY]) {
    return;
  }

  monaco.languages.register({ id: "vue" });
  monaco.languages.setLanguageConfiguration("vue", {
    comments: { blockComment: ["<!--", "-->"] },
    brackets: [
      ["<", ">"],
      ["{", "}"],
      ["(", ")"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("vue", {
    defaultToken: "",
    tokenizer: {
      root: [
        [/<!DOCTYPE/, "metatag"],
        [/(<)(template|script|style)(\s*)(>)/, ["delimiter", "tag", "", "delimiter"]],
        [/(<\/)(template|script|style)(\s*)(>)/, ["delimiter", "tag", "", "delimiter"]],
        [/\{\{|\}\}/, "delimiter.bracket"],
        [/v-[\w-]+|:[\w-]+|@[\w-]+/, "attribute.name"],
        [/".*?"/, "string"],
        [/'.*?'/, "string"],
        [/<!--/, "comment", "@comment"],
        [/<\/?[\w-]+/, "tag"],
        [/>/, "tag"],
      ],
      comment: [
        [/-->/, "comment", "@pop"],
        [/[^-]+/, "comment"],
        [/./, "comment"],
      ],
    },
  });

  registrationState[VUE_LANGUAGE_REGISTERED_KEY] = true;
}
