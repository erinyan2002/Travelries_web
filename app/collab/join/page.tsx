"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";
import { joinAlbumByCode } from "@/lib/collabUtils";
import { FolderOpen, LogIn } from "lucide-react";

function JoinForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [code,    setCode]    = useState(searchParams.get("code") ?? "");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const c = searchParams.get("code");
    if (c) setCode(c);
  }, [searchParams]);

  async function handleJoin() {
    if (!code.trim()) return;
    setJoining(true);
    try {
      const albumId = await joinAlbumByCode(code.trim());
      router.push(`/collab/${albumId}`);
    } catch (err) {
      alert(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      setJoining(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6 pb-28">
      <div className="max-w-[400px] w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-200">
            <FolderOpen size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Join Album</h1>
            <p className="text-slate-500 text-sm">초대 코드를 입력하세요</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <label className="text-xs font-bold text-slate-600 mb-2 block">Invite Code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="e.g. a1b2c3d4"
            maxLength={8}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-mono outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all text-center text-lg tracking-widest mb-4"
          />
          <button onClick={handleJoin} disabled={joining || !code.trim()}
            className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {joining ? "Joining..." : <><LogIn size={16} /> Join Album</>}
          </button>
          <div className="mt-4 text-center">
            <Link href="/collab" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              ← Back to albums
            </Link>
          </div>
        </div>
      </div>
      <BottomNav />
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
