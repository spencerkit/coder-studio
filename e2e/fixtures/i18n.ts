import { readFileSync } from "node:fs";

function readLocale(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;
}

export const E2E_LOCALES = {
  en: readLocale("../../packages/web/src/locales/en.json"),
  zh: readLocale("../../packages/web/src/locales/zh.json"),
} as const;

export type E2ELocaleCode = keyof typeof E2E_LOCALES;

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type E2ETranslationKey = NestedKeyOf<(typeof E2E_LOCALES)["zh"]>;

function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ? current : undefined;
}

export function translateForE2E(
  key: E2ETranslationKey,
  locale: E2ELocaleCode = "zh",
  params?: Record<string, string | number>
): string {
  let text = getNestedValue(E2E_LOCALES[locale], key);

  if (text === undefined) {
    throw new Error(`Missing translation for key: ${key}`);
  }

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }

  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function translatePatternForE2E(
  key: E2ETranslationKey,
  params?: Record<string, string | number>
): RegExp {
  const en = translateForE2E(key, "en", params);
  const zh = translateForE2E(key, "zh", params);
  const values = [...new Set([en, zh])].map(escapeRegExp);
  return new RegExp(`^(?:${values.join("|")})$`);
}
