import * as monaco from "monaco-editor";

let vueLanguageRegistered = false;

export function ensureVueLanguageRegistered(): void {
  if (vueLanguageRegistered) {
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

  vueLanguageRegistered = true;
}
