import type { SupportedLocale } from "./model.ts";

export const DEFAULT_LOCALE: SupportedLocale = "fr";

export function normalizeLocale(value: unknown): SupportedLocale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return language === "en" ? "en" : DEFAULT_LOCALE;
}
