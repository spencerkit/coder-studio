/**
 * Internationalization System
 *
 * Provides type-safe translations with localeAtom for switching.
 */

import { atom } from 'jotai';
import { localeAtom } from '../atoms/ui';

// Import locale files
import zh from '../locales/zh.json';
import en from '../locales/en.json';

/**
 * Available locales
 */
export const LOCALES = {
  zh: { name: '中文', data: zh },
  en: { name: 'English', data: en },
} as const;

export type LocaleCode = keyof typeof LOCALES;

/**
 * Translation dictionary type (generated from zh.json)
 */
type TranslationKeys = typeof zh;
type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<typeof zh>;

/**
 * Get nested value from object by dot-notation path
 */
function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Create a translator function for a given locale
 */
export function createTranslator(locale: LocaleCode) {
  const localeData = LOCALES[locale]?.data ?? zh;

  /**
   * Translate a key with optional interpolation
   */
  function t(key: string, params?: Record<string, string | number>): string {
    let text = getNestedValue(localeData, key);

    if (text === undefined) {
      console.warn(`Translation missing for key: ${key}`);
      return key;
    }

    // Interpolate params: {count} -> actual value
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }

    return text;
  }

  return t;
}

/**
 * Create translator atom (derived from localeAtom)
 */
export const tAtom = atom((get) => {
  const locale = get(localeAtom) as LocaleCode;
  return createTranslator(locale);
});

/**
 * Format number according to locale
 */
export function formatNumber(value: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(value);
}

/**
 * Format relative time according to locale
 */
export function formatRelativeTime(
  timestamp: number,
  locale: LocaleCode
): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const rtf = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  });

  if (days > 0) return rtf.format(-days, 'day');
  if (hours > 0) return rtf.format(-hours, 'hour');
  if (minutes > 0) return rtf.format(-minutes, 'minute');
  return rtf.format(-seconds, 'second');
}

/**
 * Format date according to locale
 */
export function formatDate(
  timestamp: number,
  locale: LocaleCode,
  options?: Intl.DateTimeFormatOptions
): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };

  return new Intl.DateTimeFormat(
    locale === 'zh' ? 'zh-CN' : 'en-US',
    { ...defaultOptions, ...options }
  ).format(timestamp);
}

/**
 * React hook for translations
 */
import { useAtomValue } from 'jotai';
export function useTranslation(): (key: string, params?: Record<string, string | number>) => string {
  return useAtomValue(tAtom);
}
