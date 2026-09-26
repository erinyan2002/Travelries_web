"use client";

import { useEffect, useRef } from "react";

// A round crop of one face (normalized box) from a photo, drawn on a canvas.
export default function FaceChip({ imageUrl, box, index, size = 64, ringClass = "ring-blue-400" }: {
  imageUrl: string;
  box: { x: number; y: number; width: number; height: number };
  /** Shown as "#n" under the chip; omit to show nothing. */
  index?: number;
  size?: number;
  ringClass?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const px = box.x * img.width, py = box.y * img.height;
      const pw = box.width * img.width, ph = box.height * img.height;
      const pad = Math.min(pw, ph) * 0.25;
      const sx = Math.max(0, px - pad), sy = Math.max(0, py - pad);
      const sw = Math.min(img.width - sx, pw + pad * 2);
      const sh = Math.min(img.height - sy, ph + pad * 2);
      canvas.width = size; canvas.height = size;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    };
  }, [imageUrl, box, size]);
  return (
    <div className="text-center flex-shrink-0">
      <canvas
        ref={canvasRef}
        style={{ width: `${size}px`, height: `${size}px` }}
        className={`rounded-full ring-2 ring-offset-2 ${ringClass} block shadow-sm`}
      />
      {index != null && <span className="text-[10px] text-slate-400 mt-1.5 block">#{index + 1}</span>}
    </div>
  );
}
