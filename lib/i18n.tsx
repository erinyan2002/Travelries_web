"use client";

// English ⇄ Korean UI. The English text itself is the key: components call
// t("Save") or tn(n, "{n} photo", "{n} photos") and Korean comes from KO
// (lib/i18n-ko.ts), falling back to the English. Strings kept in constants are
// wrapped in msg("...") so they can be found, and passed through t() when shown.
// lib/i18n.test.ts fails when any such literal has no Korean entry.
//
// The choice lives in the `lang` cookie, read by app/layout.tsx on the server,
// so the first paint is already in the right language (no English flash).

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { KO } from "./i18n-ko";

import { LANG_COOKIE, type Lang } from "./langCookie";
export { LANG_COOKIE, type Lang };

type Vars = Record<string, string | number>;
export type T = (en: string, vars?: Vars) => string;
export type TN = (n: number, one: string, other: string, vars?: Vars) => string;

/** Marks an English UI string kept in a constant; translate it with t() when rendering. */
export const msg = (en: string) => en;

export function translate(lang: Lang, en: string, vars?: Vars): string {
  const text = lang === "ko" ? (KO[en] ?? en) : en;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** For code outside React (canvas cards, helpers): the language currently on <html lang>. */
export function currentLang(): Lang {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang === "ko" ? "ko" : "en";
}

export function translateN(lang: Lang, n: number, one: string, other: string, vars?: Vars): string {
  return translate(lang, n === 1 ? one : other, { n, ...vars });
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: T; tn: TN };
const LangContext = createContext<Ctx>({
  lang: "en", setLang: () => {},
  t: (en, v) => translate("en", en, v),
  tn: (n, one, other, v) => translateN("en", n, one, other, v),
});

export function LanguageProvider({ initialLang, children }: { initialLang: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);
  const t = useCallback<T>((en, vars) => translate(lang, en, vars), [lang]);
  const tn = useCallback<TN>((n, one, other, vars) => translateN(lang, n, one, other, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, tn }), [lang, setLang, t, tn]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  return useContext(LangContext);
}

/** Locale for toLocaleDateString / Intl in the current UI language. */
export function localeOf(lang: Lang): string {
  return lang === "ko" ? "ko-KR" : "en-US";
}
