"use client";

// Who liked a post — opened from the like count in the feed and on the post page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Loader2, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { fetchPostLikers, Profile } from "@/lib/socialUtils";
import { useLang } from "@/lib/i18n";

export default function LikersModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { t } = useLang();
  const [likers, setLikers] = useState<Profile[] | null>(null);

  useEffect(() => {
    fetchPostLikers(postId).then(setLikers);
  }, [postId]);

  return (
    <div className="fixed inset-0 tv-overlay z-[3000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="tv-modal p-5 max-w-sm w-full max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold text-slate-900 flex items-center gap-1.5">
            <Heart size={16} className="fill-red-500 text-red-500" /> {t("Likes")}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto space-y-1">
          {likers === null && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5 py-6 justify-center"><Loader2 size={12} className="animate-spin" /> {t("Loading...")}</p>
          )}
          {likers?.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">{t("No likes yet.")}</p>
          )}
          {likers?.map((p) => (
            <Link key={p.id} href={`/u/${p.id}`} className="flex items-center gap-3 px-1 py-1.5 rounded-xl hover:bg-slate-50">
              <Avatar name={p.name || t("Traveler")} url={p.avatar_url} />
              <p className="text-sm font-semibold text-slate-800 truncate">{p.name || t("Traveler")}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
