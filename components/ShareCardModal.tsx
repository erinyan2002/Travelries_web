"use client";

import { useEffect, useRef, useState } from "react";
import { X, Download, Share2, Loader2 } from "lucide-react";
import { saveImage } from "@/lib/saveImage";

// Instagram Story aspect ratio (9:16). Rendered at a fixed pixel size so the
// exported PNG looks sharp regardless of the viewer's screen density.
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

type ShareCardModalProps = {
  title: string;
  fileName: string;
  onClose: () => void;
  // Runs once against a fresh 1080x1920 canvas context to paint the card.
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => Promise<void> | void;
};

// Generic "render a card to canvas, then download or share it as an image"
// modal — used by both the Albums photo story card and the Stats Year in
// Review card, which differ only in what they draw.
export default function ShareCardModal({ title, fileName, onClose, draw }: ShareCardModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [drawError, setDrawError] = useState(false);
  const [busy, setBusy] = useState(false);
  // The PNG is made as soon as the card is drawn, so Save/Share can open the phone's
  // share sheet right after the tap (iOS refuses it once the tap is too old).
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    Promise.resolve(draw(ctx, CARD_WIDTH, CARD_HEIGHT))
      .then(() => new Promise<void>((resolve) => canvas.toBlob((b) => { blobRef.current = b; resolve(); }, "image/png")))
      .then(() => setReady(true))
      .catch((err) => { console.error("Share card draw failed:", err); setDrawError(true); });
    // `draw` is supplied once by the caller when the modal opens — this should run exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phones: the share sheet, whose "Save Image" puts the card in Photos. Computers: a download.
  async function handleDownload() {
    if (blobRef.current) await saveImage(blobRef.current, fileName);
  }

  async function handleShare() {
    setBusy(true);
    try {
      const blob = blobRef.current;
      if (!blob) return;
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Travelries" });
      } else {
        await handleDownload();
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") console.error("Share failed:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 tv-overlay z-[5000] flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="tv-modal p-4 max-w-xs w-full flex flex-col items-center gap-3 my-auto max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full flex-shrink-0">
          <p className="font-bold text-slate-900 text-sm">{title}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>

        <div
          className="relative rounded-xl bg-slate-100 overflow-hidden flex-shrink-0"
          style={{ height: "min(62vh, 512px)", width: "auto", aspectRatio: "9 / 16" }}
        >
          <canvas ref={canvasRef} className="w-full h-full" style={{ display: ready ? "block" : "none" }} />
          {!ready && !drawError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" size={24} />
            </div>
          )}
          {drawError && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <p className="text-xs text-slate-400 text-center">Couldn&apos;t create the card. Please try again.</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 w-full">
          <button onClick={handleDownload} disabled={!ready}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            <Download size={15} /> Save
          </button>
          <button onClick={handleShare} disabled={!ready || busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold text-sm hover:from-sky-600 hover:to-blue-700 shadow-md shadow-blue-200/70 transition-all disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />} Share
          </button>
        </div>
      </div>
    </div>
  );
}
