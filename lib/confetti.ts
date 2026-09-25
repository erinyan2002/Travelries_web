// A tiny dependency-free confetti burst: one throwaway full-screen canvas,
// ~180 paper bits in the brand palette, gone after ~2.8s. Skipped when the
// user asks for reduced motion.
const COLORS = ["#38bdf8", "#0ea5e9", "#22d3ee", "#a5f3fc", "#fbbf24", "#fb7185", "#ffffff"];

export function burstConfetti(opts: { x?: number; y?: number; count?: number } = {}) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "9999",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  const ox = (opts.x ?? 0.5) * w, oy = (opts.y ?? 0.45) * h;
  const parts = Array.from({ length: opts.count ?? 180 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 7 + Math.random() * 11;
    return {
      x: ox, y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 7,
      size: 10 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      tilt: Math.random() * Math.PI,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < 0.3,
    };
  });

  const DURATION = 2800;
  const start = performance.now();
  function frame(now: number) {
    const t = now - start;
    ctx!.clearRect(0, 0, w, h);
    ctx!.globalAlpha = t > DURATION - 600 ? Math.max(0, (DURATION - t) / 600) : 1;
    for (const p of parts) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.32;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      p.tilt += 0.12;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rot);
      ctx!.fillStyle = p.color;
      if (p.round) {
        ctx!.beginPath();
        ctx!.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
        ctx!.fill();
      } else {
        // Scaling by cos(tilt) makes each strip flip like falling paper.
        ctx!.fillRect(-p.size / 2, -p.size / 3 * Math.cos(p.tilt), p.size, (p.size / 1.5) * Math.cos(p.tilt));
      }
      ctx!.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
