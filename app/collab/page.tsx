"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import PageHero from "@/components/PageHero";
import { createAlbum, getMyAlbums, CollabAlbum } from "@/lib/collabUtils";
import { FolderOpen, Plus, X, LogIn } from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  owner:       "bg-violet-100 text-violet-700",
  contributor: "bg-blue-100 text-blue-700",
  viewer:      "bg-slate-100 text-slate-500",
};

export default function CollabPage() {
  const [albums,     setAlbums]     = useState<CollabAlbum[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name,       setName]       = useState("");
  const [desc,       setDesc]       = useState("");
  const [creating,   setCreating]   = useState(false);
  const router = useRouter();

  useEffect(() => {
    getMyAlbums().then((a) => { setAlbums(a); setLoading(false); });
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const album = await createAlbum(name.trim(), desc.trim());
      setAlbums((prev) => [album, ...prev]);
      setShowCreate(false);
      setName("");
      setDesc("");
      router.push(`/collab/${album.id}`);
    } catch (err) {
      alert(`Album creation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-6 py-8 pb-28">
      <div className="max-w-3xl mx-auto">

        <PageHero
          icon={FolderOpen}
          title="Collab Albums"
          subtitle="Create shared albums and collect photos together."
          action={
            <div className="flex gap-2">
              <Link href="/collab/join"
                className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors">
                <LogIn size={15} /> Join
              </Link>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-br from-sky-500 to-blue-500 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-200">
                <Plus size={15} /> New Album
              </button>
            </div>
          }
        />

        {loading ? (
          <div className="text-center text-slate-400 text-sm py-16 animate-pulse">Loading...</div>
        ) : albums.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FolderOpen size={28} className="text-slate-300" />
            </div>
            <p className="font-bold text-slate-700 mb-1">No albums yet</p>
            <p className="text-slate-400 text-sm mb-5">Create a new album or join one with an invite code.</p>
            <div className="flex gap-2 justify-center">
              <Link href="/collab/join"
                className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-200 transition-colors">
                Join with code
              </Link>
              <button onClick={() => setShowCreate(true)}
                className="px-4 py-2 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 transition-colors">
                Create album
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {albums.map((album) => (
              <Link key={album.id} href={`/collab/${album.id}`}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-blue-300 hover:shadow-md transition-all block">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="font-bold text-slate-900 text-base truncate">{album.name}</h2>
                      {album.role && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${ROLE_COLORS[album.role] ?? ""}`}>
                          {album.role}
                        </span>
                      )}
                    </div>
                    {album.description && (
                      <p className="text-sm text-slate-400 truncate">{album.description}</p>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 flex-shrink-0 text-right">
                    <p>Code: <code className="font-mono font-bold text-blue-600">{album.invite_code}</code></p>
                    <p className="mt-0.5">{new Date(album.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-[3000] flex items-center justify-center p-4"
          onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-[440px] w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900">Create Album</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1 block">Album name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. Summer Trip"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1 block">Description (optional)</label>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
                  placeholder="Album description..."
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all resize-none" />
              </div>
              <button onClick={handleCreate} disabled={creating || !name.trim()}
                className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                {creating ? "Creating..." : "Create Album"}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
