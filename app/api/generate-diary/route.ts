// AI travel diary, generated on the Next.js server (Vercel) rather than the
// optional Python backend, so it also works on the deployed site and on phones.
// Same prompt and model fallback as backend/utils/gemini_utils.py. Needs
// GOOGLE_API_KEY in the server environment (.env.local / Vercel env vars).
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

type Entry = {
  fileName: string;
  imageUrl?: string;
  location?: string;
  captureDate?: string;
  captureTime?: string;
  faceCount?: number;
};

// Tried in order; a busy or slow model falls through to the next one.
const MODEL_CHAIN: { model: string; thinking?: string }[] = [
  { model: "gemini-3.5-flash", thinking: "MINIMAL" },
  { model: "gemini-3.5-flash-lite" },
  { model: "gemini-3.1-flash-lite" },
];
const PER_CALL_TIMEOUT_MS = 10_000;
const FALLTHROUGH = new Set([429, 500, 503, 504]);
const COOLDOWN_MS = 5 * 60_000;
const cooldownUntil = new Map<string, number>(); // per server instance
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

// Only public Supabase Storage URLs of this project are fetched: the URL comes
// from the browser, so this must not let anyone make the server fetch arbitrary addresses.
function isOurPublicImage(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
    return u.protocol === "https:" && u.hostname === project && u.pathname.startsWith("/storage/v1/object/public/");
  } catch { return false; }
}

async function fetchImage(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return { data: buf.toString("base64"), mimeType: res.headers.get("content-type") ?? "image/jpeg" };
  } catch {
    return null; // a missing photo just means text-only for that one
  }
}

function meta(e: Entry): string {
  const parts = [e.captureDate, e.captureTime, e.location].filter(Boolean) as string[];
  if (e.faceCount) parts.push(`${e.faceCount} people in the photo`);
  return parts.length > 0 ? parts.join(" / ") : e.fileName;
}

export async function POST(req: Request) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return json({ error: "AI diary isn't set up on this server yet (GOOGLE_API_KEY is missing)." });

  // Signed-in users only, so the API key can't be used by anyone on the internet.
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please sign in again." }, 401);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: "Please sign in again." }, 401);

  const body = await req.json().catch(() => null) as { language?: string; entries?: Entry[] } | null;
  const entries = (body?.entries ?? []).slice(0, 60);
  if (entries.length === 0) return json({ error: "No photos to write about." }, 400);
  const langName = body?.language === "ko" ? "Korean" : "English";

  const images = await Promise.all(
    entries.slice(0, MAX_IMAGES).map((e) => (isOurPublicImage(e.imageUrl) ? fetchImage(e.imageUrl) : Promise.resolve(null))),
  );
  const parts: object[] = [{ text: "Photos from this trip, in order:" }];
  entries.forEach((e, i) => {
    parts.push({ text: `Photo ${i + 1}: ${meta(e)}` });
    const img = images[i];
    if (img) parts.push({ inlineData: img });
  });

  const systemText =
    "You write short, warm first-person travel diary entries from a trip's photos " +
    "and their metadata (date, time, location, how many people). Go through the " +
    "trip in order and mention what EACH photo shows — every photo should be " +
    "reflected, not just the first. Describe only what is visible or implied; " +
    "don't invent names, food or events you can't see. " +
    `${Math.max(3, Math.min(entries.length + 2, 8))} sentences at most. Write in ${langName}.`;

  const now = Date.now();
  const chain = MODEL_CHAIN.filter((m) => (cooldownUntil.get(m.model) ?? 0) <= now);
  let lastError = "";
  for (const { model, thinking } of chain.length > 0 ? chain : MODEL_CHAIN.slice(-1)) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 1024, ...(thinking && { thinkingConfig: { thinkingLevel: thinking } }) },
        }),
      });
      if (FALLTHROUGH.has(res.status)) {
        cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      if (!res.ok) return json({ error: data?.error?.message ?? `AI request failed (${res.status}).` });
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (!text) return json({ error: "The AI didn't write anything this time. Please try again." });
      console.log(`[generate-diary] ok model=${model} photos=${entries.length} images=${images.filter(Boolean).length}`);
      return json({ diary: text });
    } catch (err) {
      // timeout → next model
      cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  console.warn(`[generate-diary] all models failed: ${lastError}`);
  return json({ error: "The AI service is busy right now. Please try again in a minute." });
}
