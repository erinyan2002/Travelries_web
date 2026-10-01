"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { supabase, getSessionUser } from "@/lib/supabase";

// The EN / 한국어 switch, fixed at the top right.
// - Signed out (login, public share pages): an EN | 한국어 pill in the corner.
// - Signed in, below xl: the same pill left of the notification bell (pages keep a
//   pt-16 row free for both).
// - Signed in, xl+: a round button right above the bell, which NotificationBell
//   moves down to make room; a pill there covered the page's own top-right buttons.
export default function LanguageToggle() {
  const { lang, setLang, t } = useLang();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    getSessionUser().then(({ data: { user } }) => setSignedIn(!!user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => subscription.unsubscribe();
  }, []);

  const pill = (
    <div className="flex items-center h-11 p-1 bg-white rounded-full shadow-lg border border-slate-200" role="group" aria-label={t("Language")}>
      {(["en", "ko"] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`h-full px-3 rounded-full text-xs font-bold transition-colors ${
            lang === l ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
          {l === "en" ? "EN" : "한국어"}
        </button>
      ))}
    </div>
  );

  if (!signedIn) return <div className="fixed top-4 right-4 z-[2000]">{pill}</div>;

  return (
    <>
      <div className="xl:hidden fixed top-4 right-[68px] z-[2000]">{pill}</div>
      <button type="button" onClick={() => setLang(lang === "en" ? "ko" : "en")}
        title={lang === "en" ? "한국어로 보기" : "View in English"}
        aria-label={lang === "en" ? "한국어로 보기" : "View in English"}
        className="hidden xl:flex fixed top-4 right-4 z-[2000] w-11 h-11 flex-col items-center justify-center gap-px bg-white rounded-full shadow-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition-colors">
        <Languages size={15} />
        <span className="text-[9px] font-extrabold leading-none">{lang === "en" ? "EN" : "한"}</span>
      </button>
    </>
  );
}
