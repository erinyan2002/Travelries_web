// "Saved!" celebration for photo saves: a paper plane swoops across the screen
// on a curved path, drawing a dashed flight trail that fades out behind it, with
// a few small clouds puffing along the way. One throwaway full-screen canvas,
// gone after ~2.6s; skipped when the user asks for reduced motion.
// (Confetti, lib/confetti.ts, is still used for a freshly written AI diary.)

type Pt = { x: number; y: number };

const FLIGHT_MS = 1900;
const FADE_MS = 700;

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Paper plane pointing along +x, centred near its fold.
function drawPlane(ctx: CanvasRenderingContext2D, s: number) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  // upper wing
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.9, -s * 0.6);
  ctx.lineTo(-s * 0.35, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // lower wing (in shadow)
  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.35, 0);
  ctx.lineTo(-s * 0.7, s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // keel fold
  ctx.fillStyle = "#0369a1";
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.35, 0);
  ctx.lineTo(-s * 0.2, s * 0.22);
  ctx.closePath();
  ctx.fill();
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x - r * 0.9, y, r * 0.65, 0, Math.PI * 2);
  ctx.arc(x, y - r * 0.35, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.95, y, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

export function flyPaperPlane() {
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

  // Low on the left, a dip through the middle, out high on the right.
  const p0 = { x: -0.08 * w, y: 0.78 * h };
  const p1 = { x: 0.3 * w,   y: 0.18 * h };
  const p2 = { x: 0.62 * w,  y: 0.95 * h };
  const p3 = { x: 1.1 * w,   y: 0.12 * h };
  const size = Math.max(28, Math.min(46, w * 0.036));
  const clouds = [0.22, 0.5, 0.78].map((t, i) => ({ t, at: bezier(p0, p1, p2, p3, t), r: size * (0.5 + 0.15 * i) }));

  const start = performance.now();
  function frame(now: number) {
    const elapsed = now - start;
    const t = easeInOut(Math.min(1, elapsed / FLIGHT_MS));
    const fade = elapsed > FLIGHT_MS ? Math.max(0, 1 - (elapsed - FLIGHT_MS) / FADE_MS) : 1;
    ctx!.clearRect(0, 0, w, h);

    // Clouds puff up once the plane has passed them, then drift and fade.
    for (const c of clouds) {
      if (t < c.t) continue;
      const age = Math.min(1, (t - c.t) / 0.35);
      ctx!.globalAlpha = fade * (1 - age * 0.35);
      ctx!.fillStyle = "#ffffff";
      ctx!.shadowColor = "rgba(14, 165, 233, 0.25)";
      ctx!.shadowBlur = 10;
      ctx!.shadowOffsetY = 3;
      drawCloud(ctx!, c.at.x - age * 18, c.at.y + 14, c.r * (0.6 + 0.4 * age));
      ctx!.shadowColor = "transparent";
    }

    // Dashed trail, fading toward its tail.
    const steps = Math.max(2, Math.round(t * 80));
    ctx!.lineWidth = 3;
    ctx!.lineCap = "round";
    ctx!.setLineDash([8, 9]);
    for (let i = 1; i <= steps; i++) {
      const a = bezier(p0, p1, p2, p3, ((i - 1) / steps) * t);
      const b = bezier(p0, p1, p2, p3, (i / steps) * t);
      ctx!.globalAlpha = fade * (0.2 + 0.7 * (i / steps));
      ctx!.strokeStyle = "#38bdf8";
      ctx!.beginPath();
      ctx!.moveTo(a.x, a.y);
      ctx!.lineTo(b.x, b.y);
      ctx!.stroke();
    }
    ctx!.setLineDash([]);

    // The plane, turned along the path.
    if (elapsed <= FLIGHT_MS) {
      const at = bezier(p0, p1, p2, p3, t);
      const ahead = bezier(p0, p1, p2, p3, Math.min(1, t + 0.01));
      ctx!.globalAlpha = 1;
      ctx!.save();
      ctx!.translate(at.x, at.y);
      ctx!.rotate(Math.atan2(ahead.y - at.y, ahead.x - at.x));
      ctx!.shadowColor = "rgba(2, 132, 199, 0.35)";
      ctx!.shadowBlur = 12;
      ctx!.shadowOffsetY = 6;
      drawPlane(ctx!, size);
      ctx!.restore();
    }

    if (elapsed < FLIGHT_MS + FADE_MS) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
