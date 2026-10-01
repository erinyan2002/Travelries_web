"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ScanFace, ShieldCheck, Trash2, ChevronDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { isFaceAnalysisEnabled, setFaceAnalysisEnabled } from "@/lib/faceSettings";
import { deleteAllFaceData } from "@/lib/photosApi";
import { useLang } from "@/lib/i18n";

// Profile → Face analysis: the privacy controls for face recognition.
export default function FaceAnalysisSettings({ uid }: { uid: string }) {
  const { t, tn } = useLang();
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { isFaceAnalysisEnabled().then(setEnabled); }, []);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setMsg(null);
    try {
      await setFaceAnalysisEnabled(next);
      setEnabled(next);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : t("Couldn't save the setting.") });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setMsg(null);
    try {
      const r = await deleteAllFaceData(uid);
      setMsg({ ok: true, text: tn(r.photosCleared + r.faceOnlyDeleted, "Face data deleted from {n} photo.", "Face data deleted from {n} photos.") });
      setConfirmDelete(false);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : t("Couldn't delete face data.") });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div id="face-analysis" className="tv-card p-5 scroll-mt-20">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-md shadow-sky-200">
          <ScanFace size={16} className="text-white" />
        </span>
        <p className="font-bold text-slate-800">{t("Face analysis")}</p>
      </div>

      {/* Toggle */}
      <button type="button" role="switch" aria-checked={enabled} onClick={toggle} disabled={saving}
        className="w-full flex items-center justify-between gap-3 text-left">
        <span>
          <span className="block text-sm font-bold text-slate-700">{t("Enable face detection")}</span>
          <span className="block text-xs text-slate-400 mt-0.5">
            {enabled ? t("New photos are scanned for faces so the Faces page can group people.") : t("New photos are saved without detecting faces.")}
          </span>
        </span>
        <span className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-slate-300"}`}>
          <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 35 }}
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow ${enabled ? "right-0.5" : "left-0.5"}`} />
        </span>
      </button>

      {/* How it works */}
      <button type="button" onClick={() => setShowHow((v) => !v)}
        className="mt-4 w-full flex items-center justify-between text-sm font-bold text-slate-700 py-2 border-t border-slate-100">
        <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-500" /> {t("How face recognition works")}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${showHow ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {showHow && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden text-xs text-slate-500 leading-relaxed space-y-1.5 pl-6 list-disc">
            <li><strong className="text-slate-700">{t("Purpose:")}</strong> {t("face recognition is used only to organize your own travel photos, like grouping who you traveled with.")}</li>
            <li><strong className="text-slate-700">{t("What is stored:")}</strong> {t("for each face, its position in the photo and a list of numbers (a “face descriptor”) used to tell whether two faces match. The names you give people are stored too.")}</li>
            <li><strong className="text-slate-700">{t("Who can see it:")}</strong> {t("only you. It lives in your private photo records, protected by row-level security. It is never shown to other users, shared or used for ads.")}</li>
            <li><strong className="text-slate-700">{t("Where it runs:")}</strong> {t("in your browser, or on the Travelries server when it is online. The server deletes each photo right after analyzing it.")}</li>
            <li><strong className="text-slate-700">{t("Your control:")}</strong> {t("turn detection off at any time, and delete all face data below.")}</li>
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Delete */}
      <div className="mt-2 pt-3 border-t border-slate-100">
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 text-sm font-bold text-red-500 hover:text-red-600">
            <Trash2 size={15} /> {t("Delete all face data")}
          </button>
        ) : (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3">
            <p className="text-sm font-bold text-red-600">{t("Delete all face data?")}</p>
            <p className="text-xs text-red-500/90 mt-1 leading-relaxed">
              {t("Removes every detected face, face descriptor and named person. Your photos stay in Albums and Map, but photos you saved only to Faces are deleted. This can't be undone.")}
            </p>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-60">
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {t("Delete")}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="text-xs font-bold text-slate-500 px-3 py-2 rounded-lg hover:bg-white">
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {msg && (
        <p className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>
          {msg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {msg.text}
        </p>
      )}
    </div>
  );
}
