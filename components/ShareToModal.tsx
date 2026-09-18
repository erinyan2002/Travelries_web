"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link2, Loader2, Search, Send, X, Check } from "lucide-react";
import Avatar from "@/components/Avatar";
import { fetchFollowingProfiles, sharePostToUser, Profile, Post } from "@/lib/socialUtils";
import { sharePhoto } from "@/lib/shareUtils";

// Instagram-style "Send" sheet for a feed post: an in-app list of people you
// follow (each send delivers a `post_shared` notification, no OS share sheet
// involved) plus a "Copy Link" fallback that reuses the existing public
// /share/[id] link generation — kept because that link works for people who
// don't follow you too, unlike an in-app send.
export default function ShareToModal({ post, uid, onClose }: { post: Post; uid: string; onClose: () => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [query, setQuery] = useState("");
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    fetchFollowingProfiles(uid).then(setProfiles);
  }, [uid]);

  const filtered = (profiles ?? []).filter((p) =>
    (p.name || "Traveler").toLowerCase().includes(query.trim().toLowerCase())
  );

  async function handleSend(targetId: string) {
    setSendingId(targetId);
    setSendError(null);
    try {
      await sharePostToUser(post.id, targetId);
      setSentIds((prev) => new Set(prev).add(targetId));
    } catch (err) {
      console.error("Share failed:", err);
      setSendError(err instanceof Error ? err.message : "Failed to send. Please try again.");
    } finally {
      setSendingId(null);
    }
  }

  async function handleCopyLink() {
    setCopying(true);
    setCopyError(null);
    try {
      const url = await sharePhoto({
        id: post.id,
        fileName: post.caption || "Travelries post",
        imageUrl: post.imageUrl,
        location: post.location ?? undefined,
        captureDate: post.captureDate ?? undefined,
        faceCount: 0,
      });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy link failed:", err);
      setCopyError(err instanceof Error ? err.message : "Failed to create link. Please try again.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-5"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800">Share</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-3 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people you follow..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
        </div>

        {sendError && (
          <p className="mx-5 mb-2 text-xs font-semibold text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {sendError}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-1">
          {profiles === null ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10 px-5">
              {profiles.length === 0 ? "Follow people to send them posts directly." : "No one found."}
            </p>
          ) : (
            filtered.map((p) => {
              const sent = sentIds.has(p.id);
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50">
                  <Avatar name={p.name || "Traveler"} url={p.avatar_url} />
                  <p className="text-sm font-semibold text-slate-800 flex-1 min-w-0 truncate">{p.name || "Traveler"}</p>
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={() => handleSend(p.id)}
                    disabled={sendingId === p.id || sent}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors flex-shrink-0 ${
                      sent ? "bg-emerald-50 text-emerald-600" : "bg-blue-600 text-white hover:bg-blue-700"
                    } disabled:opacity-70`}
                  >
                    {sendingId === p.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : sent ? (
                      <><Check size={12} /> Sent</>
                    ) : (
                      <><Send size={12} /> Send</>
                    )}
                  </motion.button>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-slate-100">
          {copyError && (
            <p className="mb-2 text-xs font-semibold text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {copyError}
            </p>
          )}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleCopyLink}
            disabled={copying}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors disabled:opacity-70"
          >
            <AnimatePresence mode="wait" initial={false}>
              {copying ? (
                <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Creating link...
                </motion.span>
              ) : copied ? (
                <motion.span key="copied" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-emerald-600">
                  <Check size={16} /> Link copied!
                </motion.span>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <Link2 size={16} /> Copy Link
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
