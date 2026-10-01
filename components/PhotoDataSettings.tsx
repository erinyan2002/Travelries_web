"use client";

import { useEffect, useState } from "react";
import { Images, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { countPhotos, deleteAllPhotos } from "@/lib/photosApi";
import { useLang } from "@/lib/i18n";

// Profile → Your photos: deleting everything lives here, with the other account
// data controls, rather than on the Map page (which only saw map photos).
export default function PhotoDataSettings({ uid }: { uid: string }) {
  const { t, tn } = useLang();
  const [count, setCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { countPhotos(uid).then(setCount); }, [uid]);

  async function handleDelete() {
    setDeleting(true);
    setMsg(null);
    try {
      const r = await deleteAllPhotos(uid);
      setMsg(r.failed > 0
        ? { ok: false, text: t("{deleted} deleted, {failed} couldn't be deleted. Please try again.", { deleted: r.deleted, failed: r.failed }) }
        : { ok: true, text: tn(r.deleted, "Deleted {n} photo.", "Deleted {n} photos.") });
      setConfirm(false);
      setCount(await countPhotos(uid));
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : t("Couldn't delete your photos.") });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div id="your-photos" className="tv-card p-5 scroll-mt-20">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-400 to-red-500 flex items-center justify-center shadow-md shadow-rose-200">
          <Images size={16} className="text-white" />
        </span>
        <div>
          <p className="font-bold text-slate-800 leading-tight">{t("Your photos")}</p>
          <p className="text-xs text-slate-400">{count === null ? "…" : tn(count, "{n} photo saved", "{n} photos saved")}</p>
        </div>
      </div>

      {!confirm ? (
        <button type="button" onClick={() => setConfirm(true)} disabled={!count}
          className="flex items-center gap-2 text-sm font-bold text-red-500 hover:text-red-600 disabled:text-slate-300">
          <Trash2 size={15} /> {t("Delete all photos")}
        </button>
      ) : (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <p className="text-sm font-bold text-red-600">{t("Delete all {n} photos?", { n: count ?? 0 })}</p>
          <p className="text-xs text-red-500/90 mt-1 leading-relaxed">
            {t("Removes every photo from Albums, Map, People and Saved, along with their faces, trips and named people. Posts you already shared to the feed stay. This can't be undone.")}
          </p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-60">
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {deleting ? t("Deleting…") : t("Delete everything")}
            </button>
            <button type="button" onClick={() => setConfirm(false)} disabled={deleting}
              className="text-xs font-bold text-slate-500 px-3 py-2 rounded-lg hover:bg-white">
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>
          {msg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {msg.text}
        </p>
      )}
    </div>
  );
}
