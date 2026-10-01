"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Move } from "lucide-react";
import { useLang } from "@/lib/i18n";
import {
  POST_ASPECT, CropRect, CropView, Size, centeredView, clampView, cropRectOf, zoomView,
} from "@/lib/crop";

// Drag to move, slider (or pinch) to zoom: picks the part of a photo that
// a feed post shows in its 4:5 frame. Reports the visible part as a CropRect;
// the parent renders it with cropToBlob when posting.
export default function ImageCropper({ src, onChange }: { src: string; onChange: (rect: CropRect) => void }) {
  const { t } = useLang();
  const frameRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<Size | null>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  // null = not moved yet: centered (see `view` below).
  const [moved, setView] = useState<CropView | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; view: CropView } | null>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // Frame size follows the layout (the modal is narrower on phones).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    // A new frame size starts centered again.
    const ro = new ResizeObserver(() => { setFrame({ width: el.clientWidth, height: el.clientHeight }); setView(null); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Memoized: a fresh object every render would re-run the onChange effect below,
  // re-render the parent (it stores the rect), and loop.
  const view = useMemo(() => moved ?? (image && frame ? centeredView(image, frame) : null), [moved, image, frame]);

  // Callers pass a state setter, so onChange is stable.
  useEffect(() => {
    if (image && frame && view) onChange(cropRectOf(view, image, frame));
  }, [view, image, frame, onChange]);

  const ready = image && frame && view;
  const scale = ready ? Math.max(frame.width / image.width, frame.height / image.height) * view.zoom : 1;

  function setZoom(zoom: number) {
    if (image && frame && view) setView(zoomView(view, zoom, image, frame));
  }

  return (
    // Sized to fit the screen whole (no scrolling while cropping): the 4:5 frame is
    // at most ~55% of the viewport tall. The mouse wheel is left to scroll the page;
    // zooming it was easy to trigger by accident.
    <div className="space-y-2 w-full mx-auto" style={{ maxWidth: "calc(55dvh * 0.8)" }}>
      <div ref={frameRef}
        className="relative w-full overflow-hidden rounded-xl bg-slate-900 touch-none select-none cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: String(POST_ASPECT) }}
        onPointerDown={(e) => {
          if (!view) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
            drag.current = null;
          } else {
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, view };
          }
        }}
        onPointerMove={(e) => {
          if (!image || !frame) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size === 2 && view) {
            const [a, b] = [...pointers.current.values()];
            setView(zoomView(view, pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist), image, frame));
          } else if (drag.current && drag.current.id === e.pointerId) {
            const d = drag.current;
            setView(clampView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }, image, frame));
          }
        }}
        onPointerUp={(e) => { pointers.current.delete(e.pointerId); drag.current = null; if (pointers.current.size < 2) pinch.current = null; }}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); drag.current = null; pinch.current = null; }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} crossOrigin="anonymous"
          onLoad={(e) => { setImage({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); setView(null); }}
          className="absolute top-0 left-0 max-w-none pointer-events-none"
          style={ready ? {
            width: image.width * scale, height: image.height * scale,
            transform: `translate(${view.x}px, ${view.y}px)`,
          } : { opacity: 0 }} />
        {/* Rule-of-thirds guides */}
        <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/15" />)}
        </div>
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[11px] font-bold text-white bg-black/45 rounded-full px-2.5 py-1 pointer-events-none">
          <Move size={11} /> {t("Drag to choose what's shown")}
        </span>
      </div>
      <div className="flex items-center gap-2 px-1">
        <ZoomOut size={15} className="text-slate-400 flex-shrink-0" />
        <input type="range" min={1} max={4} step={0.01} value={view?.zoom ?? 1} disabled={!ready}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label={t("Zoom")}
          className="flex-1 accent-sky-500" />
        <ZoomIn size={15} className="text-slate-400 flex-shrink-0" />
      </div>
    </div>
  );
}
