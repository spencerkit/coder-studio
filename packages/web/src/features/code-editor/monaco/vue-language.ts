import * as monaco from "monaco-editor";

const VUE_LANGUAGE_REGISTERED_KEY = Symbol.for("coder-studio.monaco.vue-language.registered");

type VueLanguageRegistrationState = typeof globalThis & {
  [VUE_LANGUAGE_REGISTERED_KEY]?: boolean;
};

/**
 * Register a Vue Single-File-Component grammar with Monaco.
 *
 * We use Monarch's `nextEmbedded` mechanism to delegate the inside of each
 * SFC block to the language Monaco already knows how to highlight:
 *
 *  - `<script lang="ts">` and `<script setup lang="ts">` → `typescript`
 *  - `<script>` (default) → `javascript`
 *  - `<style lang="scss">` → `scss`; otherwise → `css`
 *
 * The `<template>` block stays inside our own state because Monaco doesn't
 * understand Vue-flavoured HTML (directives, mustaches). We hand-roll a small
 * tokenizer there that recognizes tags, attributes, mustache interpolation,
 * and Vue's directive shorthand (`v-…`, `:bind`, `@event`, `#slot`).
 */
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
    onEnterRules: [
      {
        beforeText: /<([_:\w][_:\w-.\d]*)([^/>]*(?!\/)>)[^<]*$/i,
        afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>/i,
        action: { indentAction: monaco.languages.IndentAction.IndentOutdent },
      },
      {
        beforeText: /<([_:\w][_:\w-.\d]*)([^/>]*(?!\/)>)[^<]*$/i,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
  });

  monaco.languages.setMonarchTokensProvider("vue", {
    defaultToken: "",
    tokenPostfix: ".vue",
    ignoreCase: true,
    tokenizer: {
      root: [
        // Opening <script[ setup][ lang="..."]> — pick the embedded language.
        [
          /(<)(script)(?=[^>]*\blang\s*=\s*["']?ts(?:x)?["']?)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@scriptTsEmbedded" }, "delimiter"],
        ],
        [
          /(<)(script)(?=[^>]*\blang\s*=\s*["']?(?:tsx|jsx)["']?)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@scriptTsEmbedded" }, "delimiter"],
        ],
        [
          /(<)(script)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@scriptJsEmbedded" }, "delimiter"],
        ],
        // Opening <style[ lang="..."]>
        [
          /(<)(style)(?=[^>]*\blang\s*=\s*["']?scss["']?)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@styleScssEmbedded" }, "delimiter"],
        ],
        [
          /(<)(style)(?=[^>]*\blang\s*=\s*["']?less["']?)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@styleLessEmbedded" }, "delimiter"],
        ],
        [
          /(<)(style)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@styleCssEmbedded" }, "delimiter"],
        ],
        // Template block stays inside our HTML-ish state.
        [
          /(<)(template)([^>]*)(>)/,
          ["delimiter", "tag", { token: "attribute", next: "@templateBlock" }, "delimiter"],
        ],
        // Comments and doctype outside of any block.
        [/<!DOCTYPE/, { token: "metatag", next: "@doctype" }],
        [/<!--/, { token: "comment", next: "@comment" }],
        // Any stray text/tags get a minimal treatment to keep colour stable.
        [/<\/?[\w-]+/, "tag"],
        [/>/, "tag"],
      ],

      // ---- <template> block --------------------------------------------------
      templateBlock: [
        [/<\/template\s*>/, { token: "delimiter", next: "@pop" }],
        [/<!--/, { token: "comment", next: "@comment" }],
        // mustache interpolation {{ expr }}
        [/\{\{/, { token: "delimiter.bracket", next: "@mustache" }],
        // tag open: `<comp` / `</comp` / `<comp.foo`
        [/(<\/?)([\w.-]+)/, ["delimiter", { token: "tag", next: "@tagAttributes" }]],
        [/[^<{}]+/, ""],
      ],
      tagAttributes: [
        [/\s+/, ""],
        [/\/?>/, { token: "delimiter", next: "@pop" }],
        // Vue directive shorthand: v-foo, :bind, @event, #slot
        [/(v-[\w-]+(?::[\w-]+)?(\.[\w-]+)*)/, "attribute.name"],
        [/[:@#][\w-]+(\.[\w-]+)*/, "attribute.name"],
        // Standard HTML attribute name
        [/[\w-]+/, "attribute.name"],
        [/=/, "delimiter"],
        [/"/, { token: "attribute.value", next: "@attributeDoubleString" }],
        [/'/, { token: "attribute.value", next: "@attributeSingleString" }],
      ],
      attributeDoubleString: [
        [/[^"]+/, "attribute.value"],
        [/"/, { token: "attribute.value", next: "@pop" }],
      ],
      attributeSingleString: [
        [/[^']+/, "attribute.value"],
        [/'/, { token: "attribute.value", next: "@pop" }],
      ],
      mustache: [
        [/\}\}/, { token: "delimiter.bracket", next: "@pop" }],
        // Inside `{{ … }}` we just keep punctuation visible; a real expression
        // tokenizer would be overkill — Volar provides the semantic highlight
        // for these once it's online.
        [/[^}]+/, "identifier"],
      ],

      // ---- <script> blocks ---------------------------------------------------
      scriptTsEmbedded: [
        [/<\/script\s*>/, { token: "delimiter", next: "@pop", nextEmbedded: "@pop" }],
        [/[^<]+/, { token: "@rematch", nextEmbedded: "typescript" }],
      ],
      scriptJsEmbedded: [
        [/<\/script\s*>/, { token: "delimiter", next: "@pop", nextEmbedded: "@pop" }],
        [/[^<]+/, { token: "@rematch", nextEmbedded: "javascript" }],
      ],

      // ---- <style> blocks ----------------------------------------------------
      styleCssEmbedded: [
        [/<\/style\s*>/, { token: "delimiter", next: "@pop", nextEmbedded: "@pop" }],
        [/[^<]+/, { token: "@rematch", nextEmbedded: "css" }],
      ],
      styleScssEmbedded: [
        [/<\/style\s*>/, { token: "delimiter", next: "@pop", nextEmbedded: "@pop" }],
        [/[^<]+/, { token: "@rematch", nextEmbedded: "scss" }],
      ],
      styleLessEmbedded: [
        [/<\/style\s*>/, { token: "delimiter", next: "@pop", nextEmbedded: "@pop" }],
        [/[^<]+/, { token: "@rematch", nextEmbedded: "less" }],
      ],

      // ---- Misc states -------------------------------------------------------
      doctype: [
        [/[^>]+/, "metatag.content"],
        [/>/, { token: "metatag", next: "@pop" }],
      ],
      comment: [
        [/-->/, { token: "comment", next: "@pop" }],
        [/[^-]+/, "comment"],
        [/./, "comment"],
      ],
    },
  });

  registrationState[VUE_LANGUAGE_REGISTERED_KEY] = true;
}
