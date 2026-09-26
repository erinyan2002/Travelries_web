// AI travel diary, generated on the Next.js server (Vercel) rather than the
// optional Python backend, so it also works on the deployed site and on phones.
// Same prompt as backend/utils/gemini_utils.py; model fallback in lib/server/gemini.ts. Needs
// GOOGLE_API_KEY in the server environment (.env.local / Vercel env vars).
import { authedUserId, generateWithFallback, json } from "@/lib/server/gemini";

export const maxDuration = 60;

type Entry = {
  fileName: string;
  imageUrl?: string;
  location?: string;
  captureDate?: string;
  captureTime?: string;
  faceCount?: number;
};

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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

  if (!(await authedUserId(req))) return json({ error: "Please sign in again." }, 401);

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

  const result = await generateWithFallback(key, {
    systemText, parts, generationConfig: { maxOutputTokens: 1024 },
  });
  if ("error" in result) return json({ error: result.error });
  console.log(`[generate-diary] ok model=${result.model} photos=${entries.length} images=${images.filter(Boolean).length}`);
  return json({ diary: result.text });
}
