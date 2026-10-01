"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import TripPostCard from "@/components/TripPostCard";
import CommentThread from "@/components/CommentThread";
import { getSessionUser } from "@/lib/supabase";
import { fetchPostById, toggleLike, deletePost, Post } from "@/lib/socialUtils";
import {
  ArrowLeft, Heart, MessageCircle, Trash2, MapPin, CalendarDays,
} from "lucide-react";
import { useLang } from "@/lib/i18n";
import { timeAgo } from "@/lib/timeAgo";

function DeletePostConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 tv-overlay z-[4000] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="tv-modal max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 size={22} className="text-red-500" />
        </div>
        <h2 className="text-lg font-black text-slate-900 text-center mb-1">{t("Delete this post?")}</h2>
        <p className="text-sm text-slate-500 text-center mb-6">{t("This cannot be undone.")}</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
            {t("Cancel")}
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-colors">
            {t("Delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLang();
  const postId = params.id as string;

  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [post, setPost] = useState<Post | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await getSessionUser();
      if (!user) { setLoading(false); return; }
      setUid(user.id);
      const p = await fetchPostById(user.id, postId);
      setPost(p);
      setLoading(false);
    }
    load();
  }, [postId]);

  async function handleLike() {
    if (!uid || !post) return;
    const nowLiked = await toggleLike(uid, post.id, post.likedByMe);
    setPost({ ...post, likedByMe: nowLiked, likeCount: post.likeCount + (nowLiked ? 1 : -1) });
  }

  async function handleDelete() {
    if (!uid || !post) return;
    await deletePost(uid, post.id);
    router.push("/feed");
  }

  if (loading) return null;

  if (!post) {
    return (
      <main className="min-h-screen px-4 sm:px-6 py-8 pb-24 lg:pb-10 flex flex-col items-center justify-center gap-3">
        <p className="text-slate-400 text-sm">{t("This post isn't available — it may have been deleted, or you may need to follow the author to see it.")}</p>
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
          <ArrowLeft size={16} /> {t("Back")}
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 pt-16 xl:pt-8 pb-24 lg:pb-10">
      <div className="max-w-2xl mx-auto space-y-5">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft size={16} /> {t("Back")}
        </button>

        <div className="tv-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Link href={`/u/${post.userId}`} className="flex items-center gap-2.5 flex-1 min-w-0">
              <Avatar name={post.authorName} url={post.authorAvatarUrl} />
              <p className="text-sm font-bold text-slate-800 truncate">{post.authorName}</p>
            </Link>
            <p className="text-xs text-slate-400">{timeAgo(post.createdAt, t)}</p>
            {post.userId === uid && (
              <button onClick={() => setConfirmDelete(true)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {post.trip ? (
            <TripPostCard trip={post.trip} authorName={post.authorName} />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.imageUrl} alt="" className="w-full max-h-[480px] object-cover" />
            </>
          )}
          <div className="px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-3">
              <button onClick={handleLike} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-red-500 transition-colors">
                <Heart size={18} className={post.likedByMe ? "fill-red-500 text-red-500" : ""} />
                {post.likeCount > 0 && post.likeCount}
              </button>
              <span className="flex items-center gap-1.5 text-sm font-bold text-slate-600">
                <MessageCircle size={18} />
                {post.commentCount > 0 && post.commentCount}
              </span>
            </div>
            {post.caption && <p className="text-sm text-slate-700">{post.caption}</p>}
            {post.taggedUsers.length > 0 && (
              <p className="text-xs text-slate-500">
                {t("with")}{" "}
                {post.taggedUsers.map((tu, i) => (
                  <span key={tu.id}>
                    <Link href={`/u/${tu.id}`} className="font-semibold text-slate-700 hover:underline">{tu.name}</Link>
                    {i < post.taggedUsers.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
            {(post.location || post.captureDate) && (
              <p className="text-xs text-slate-400 flex items-center gap-2">
                {post.location && <span className="flex items-center gap-1"><MapPin size={10} />{post.location}</span>}
                {post.captureDate && <span className="flex items-center gap-1"><CalendarDays size={10} />{post.captureDate}</span>}
              </p>
            )}
          </div>

          {uid && (
            <div className="border-t border-slate-100 px-4 py-3 bg-slate-50">
              <CommentThread
                uid={uid}
                postId={post.id}
                onCountChange={(count) => setPost((prev) => prev && { ...prev, commentCount: count })}
              />
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <DeletePostConfirmModal onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)} />
      )}
    </main>
  );
}
