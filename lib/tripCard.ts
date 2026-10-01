// "Travel Memory" story card (1080×1920) for one trip — drawn into ShareCardModal
// from the trip page. Same drawing helpers as the Year in Review card.
import { drawPolaroid, drawRouteDivider, fillTextTracked, loadImage } from "./canvasCard";
import { TripMemory, formatDistance, formatTripDates, tripTitle } from "./tripMemory";
import { translate, currentLang } from "./i18n";

// Drawn in the UI language at the moment the card is made.
const t = (en: string, vars?: Record<string, string>) => translate(currentLang(), en, vars);
import { MapPhoto } from "./types";

const FONT = "system-ui, -apple-system, 'Pretendard Variable', sans-serif";

// Scattered polaroid spots, centre photo last so it's drawn on top.
const COLLAGE = [
  { dx: -250, dy: 30, size: 250, rot: -9 },
  { dx: 250, dy: 40, size: 250, rot: 8 },
  { dx: 0, dy: 0, size: 320, rot: -2 },
];

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let t = text;
  while (ctx.measureText(t).width > maxWidth && t.length > 1) t = t.slice(0, -2) + "…";
  return t;
}

export async function drawTripMemoryCard(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  memory: TripMemory, photos: MapPhoto[], peopleCount: number,
) {
  const margin = 90;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#0c4a6e");
  bg.addColorStop(0.55, "#0369a1");
  bg.addColorStop(1, "#0891b2");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // soft sunlight wash, top-right
  const sun = ctx.createRadialGradient(w * 0.85, 120, 0, w * 0.85, 120, 700);
  sun.addColorStop(0, "rgba(255,249,230,0.35)");
  sun.addColorStop(1, "rgba(255,249,230,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.fillStyle = "#bae6fd";
  ctx.font = `700 28px ${FONT}`;
  fillTextTracked(ctx, `✈ ${t("TRAVEL MEMORY")}`, w / 2, 110, 6);

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 88px ${FONT}`;
  ctx.fillText(fitText(ctx, tripTitle(memory, t), w - margin * 2), w / 2, 215);
  ctx.font = `600 36px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(formatTripDates(memory.start, memory.end, currentLang()), w / 2, 272);

  drawRouteDivider(ctx, 320, w, margin, "rgba(255,255,255,0.3)");

  // Collage: up to 3 photos
  const picks = photos.slice(0, 3);
  const imgs = await Promise.all(picks.map((p) => loadImage(p.imageUrl).catch(() => null)));
  const spots = COLLAGE.slice(COLLAGE.length - imgs.length);
  imgs.forEach((img, i) => drawPolaroid(ctx, img, w / 2 + spots[i].dx, 590 + spots[i].dy, spots[i].size, spots[i].rot));

  drawRouteDivider(ctx, 880, w, margin, "rgba(255,255,255,0.3)");

  // Stat tiles, 2×2
  const stats = [
    { value: String(memory.dayCount), label: memory.dayCount === 1 ? t("Day") : t("Days") },
    { value: String(memory.photoCount), label: t("Photos") },
    { value: String(memory.places.length), label: memory.places.length === 1 ? t("Place") : t("Places") },
    peopleCount > 0
      ? { value: String(peopleCount), label: peopleCount === 1 ? t("Person") : t("People") }
      : { value: formatDistance(memory.distanceKm), label: t("Traveled") },
  ];
  const tileW = (w - margin * 2 - 30) / 2, tileH = 170;
  stats.forEach((s, i) => {
    const x = margin + (i % 2) * (tileW + 30), y = 920 + Math.floor(i / 2) * (tileH + 30);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.roundRect(x, y, tileW, tileH, 28);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 72px ${FONT}`;
    ctx.fillText(fitText(ctx, s.value, tileW - 40), x + tileW / 2, y + 95);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(s.label, x + tileW / 2, y + 140);
  });

  // Most visited + journey
  let y = 1370;
  if (memory.mostVisited) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(t("Most visited place"), w / 2, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 48px ${FONT}`;
    ctx.fillText(fitText(ctx, memory.mostVisited.place, w - margin * 2), w / 2, y + 60);
    y += 140;
  }
  if (memory.journey.length > 1) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(t("Your journey"), w / 2, y);
    ctx.fillStyle = "#e0f2fe";
    ctx.font = `700 36px ${FONT}`;
    // Wrap "A → B → C" onto at most 3 lines.
    const lines: string[] = [];
    let line = "";
    for (const [i, stop] of memory.journey.entries()) {
      const piece = i === 0 ? stop : ` → ${stop}`;
      if (line && ctx.measureText(line + piece).width > w - margin * 2) { lines.push(line); line = `→ ${stop}`; }
      else line += piece;
    }
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((l, i) => {
      const text = i === 2 && lines.length > 3 ? fitText(ctx, l + " …", w - margin * 2) : l;
      ctx.fillText(text, w / 2, y + 56 + i * 50);
    });
  }

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `700 26px ${FONT}`;
  fillTextTracked(ctx, "TRAVELRIES", w / 2, h - 80, 8);
}
