"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { joinAlbumByCode } from "@/lib/collabUtils";
import { FolderOpen, LogIn } from "lucide-react";
import { useLang } from "@/lib/i18n";

function JoinForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLang();
  const [code,    setCode]    = useState(searchParams.get("code") ?? "");
  const [joining, setJoining] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleJoin() {
    if (!code.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const albumId = await joinAlbumByCode(code.trim());
      router.push(`/collab/${albumId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setJoining(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 pb-24 lg:pb-10">
      <div className="max-w-[400px] w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-200/70">
            <FolderOpen size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">{t("Join Album")}</h1>
            <p className="text-slate-500 text-sm">{t("Enter your invite code")}</p>
          </div>
        </div>

        <div className="tv-card p-6">
          <label className="text-xs font-bold text-slate-600 mb-2 block">{t("Invite Code")}</label>
          <input
            value={code}
            onChange={(e) => { setCode(e.target.value.toLowerCase()); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder={t("e.g. a1b2c3d4")}
            maxLength={8}
            className={`w-full px-4 py-3 rounded-xl border text-sm font-mono outline-none focus:ring-2 transition-all text-center text-lg tracking-widest ${error ? "border-red-300 focus:border-red-400 focus:ring-red-100 mb-2" : "border-slate-200 focus:border-blue-400 focus:ring-blue-100 mb-4"}`}
          />
          {error && <p className="text-xs font-semibold text-red-500 text-center mb-4">{t(error)}</p>}
          <button onClick={handleJoin} disabled={joining || !code.trim()}
            className="w-full py-3 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold rounded-xl hover:from-sky-600 hover:to-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {joining ? t("Joining...") : <><LogIn size={16} /> {t("Join Album")}</>}
          </button>
          <div className="mt-4 text-center">
            <Link href="/collab" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              ← {t("Back to albums")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
