"use client";

// Edits a post's caption — the author's pencil button in the feed and on the post page.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { updatePostCaption } from "@/lib/socialUtils";
import { msg, useLang } from "@/lib/i18n";

export default function EditCaptionModal({
  uid, postId, caption, onSaved, onClose,
}: {
  uid: string; postId: string; caption: string | null;
  onSaved: (caption: string | null) => void; onClose: () => void;
}) {
  const { t } = useLang();
  const [text, setText] = useState(caption ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updatePostCaption(uid, postId, text);
      onSaved(text.trim() || null);
    } catch {
      setError(msg("Couldn't save. Please try again."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 tv-overlay z-[4000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="tv-modal max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-black text-slate-900 mb-3">{t("Edit post")}</h2>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={4}
          placeholder={t("Write a caption...")}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
        />
        {error && <p className="text-xs text-red-500 mt-2">{t(error)}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
            {t("Cancel")}
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 tv-btn-primary justify-center text-sm py-2.5 disabled:opacity-60">
            {saving ? <><Loader2 size={14} className="animate-spin" /> {t("Saving...")}</> : t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
