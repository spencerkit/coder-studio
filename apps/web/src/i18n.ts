export type Locale = "en" | "zh";

export type Translator = (key: string, params?: Record<string, string | number>) => string;

type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "coder-studio.locale";

// Template interpolation: replaces {key} placeholders with params values.
const interpolate = (template: string, params: TranslationParams): string =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));

// Lazy-loaded message maps, populated on first use.
let _messagesCache: Record<Locale, Record<string, string>> | null = null;

const loadMessages = async (locale: Locale): Promise<Record<string, string>> => {
  const mod = await import(`./locales/${locale}.json`);
  return mod.default as Record<string, string>;
};

const getMessages = async (): Promise<Record<Locale, Record<string, string>>> => {
  if (_messagesCache) return _messagesCache;
  const [en, zh] = await Promise.all([loadMessages("en"), loadMessages("zh")]);
  _messagesCache = { en, zh };
  return _messagesCache;
};

// Synchronous cache populated after first async load.
let _syncMessages: Record<Locale, Record<string, string>> | null = null;

export const initI18n = async (): Promise<void> => {
  _syncMessages = await getMessages();
};

// Pre-load on module import.
void initI18n().catch(() => {});

export const getPreferredLocale = (): Locale => {
  const stored = readStoredLocalePreference();
  if (stored) return stored;
  return getSystemLocale();
};

export const applyLocale = (locale: Locale) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }
};

export const persistLocale = (locale: Locale) => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {}
  }
  applyLocale(locale);
};

export const clearLocalePreference = () => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
};

export const readStoredLocalePreference = (): Locale | null => {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
    return null;
  } catch {
    return null;
  }
};

export const getSystemLocale = (): Locale => {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
    return "zh";
  }
  return "en";
};

// Synchronous translator — uses cached messages if available, otherwise falls back
// to a minimal inline default until the async load completes.
export const createTranslator = (locale: Locale): Translator => {
  return (key: string, params: Record<string, string | number> = {}): string => {
    const msgs = _syncMessages ?? _messagesCache;
    if (msgs) {
      const template = msgs[locale]?.[key] ?? msgs.en?.[key] ?? key;
      return interpolate(template, params);
    }
    // Minimal fallback before JSON loads
    return key;
  };
};

const padIndex = (value: number | string) => {
  if (typeof value === "string") return value;
  return String(value).padStart(2, "0");
};

export const formatSessionTitle = (value: number | string, locale: Locale) => {
  const t = createTranslator(locale);
  return t("formatSessionTitle", { index: padIndex(value) });
};

export const formatWorkspaceTitle = (value: number | string, locale: Locale) => {
  const t = createTranslator(locale);
  return t("formatWorkspaceTitle", { index: padIndex(value) });
};

export const formatTerminalTitle = (value: number | string, locale: Locale) => {
  const t = createTranslator(locale);
  return t("formatTerminalTitle", { value });
};

export const formatSessionReadyMessage = (value: number | string, locale: Locale) => {
  const t = createTranslator(locale);
  const sessionTitle = formatSessionTitle(value, locale);
  return t("formatSessionReady", { sessionTitle });
};

const extractGeneratedValue = (value: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

export const localizeSessionTitle = (value: string, locale: Locale) => {
  const index = extractGeneratedValue(value, [/^Session (\d+)$/, /^会话 (\d+)$/]);
  return index ? formatSessionTitle(index, locale) : value;
};

export const localizeWorkspaceTitle = (value: string, locale: Locale) => {
  const index = extractGeneratedValue(value, [/^Workspace (\d+)$/, /^工作区 (\d+)$/]);
  return index ? formatWorkspaceTitle(index, locale) : value;
};

export const localizeTerminalTitle = (value: string, locale: Locale) => {
  const index = extractGeneratedValue(value, [/^Terminal (\d+)$/, /^终端 (\d+)$/]);
  return index ? formatTerminalTitle(index, locale) : value;
};
