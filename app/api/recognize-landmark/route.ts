// AI landmark recognition for one photo, on the Next.js server (Vercel) rather than
// the optional Python backend, so "Identify Landmark" also works on the deployed site
// and on phones. Same prompt as backend/utils/gemini_utils.py recognize_landmark.
// The browser sends the photo already shrunk to ≤1024px (a few hundred KB of base64).
import { authedUserId, generateWithFallback, json } from "@/lib/server/gemini";

export const maxDuration = 60;

const MAX_BASE64_CHARS = 3_000_000; // ~2.2 MB image, well under Vercel's 4.5 MB body limit

export async function POST(req: Request) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return json({ landmark: null, error: "Landmark recognition isn't set up on this server yet (GOOGLE_API_KEY is missing)." });
  if (!(await authedUserId(req))) return json({ landmark: null, error: "Please sign in again." }, 401);

  const body = await req.json().catch(() => null) as
    { image?: string; mimeType?: string; lat?: number | null; lng?: number | null } | null;
  const image = body?.image;
  if (!image || image.length > MAX_BASE64_CHARS) return json({ landmark: null, error: "The photo couldn't be read." }, 400);
  const mimeType = body?.mimeType?.startsWith("image/") ? body.mimeType : "image/jpeg";
  const { lat, lng } = body ?? {};
  const hint = typeof lat === "number" && typeof lng === "number" ? ` The photo was taken near (${lat}, ${lng}).` : "";

  const result = await generateWithFallback(key, {
    parts: [
      { inlineData: { data: image, mimeType } },
      {
        text:
          "Is there a recognizable landmark, monument, or notable building in this photo?" + hint +
          " If yes, name it and rate your confidence. If no specific landmark is " +
          "recognizable (e.g. a generic street, beach, or indoor scene), set landmark to null." +
          ' Reply with ONLY this JSON: {"landmark": string or null, ' +
          '"confidence": "high" | "medium" | "low" | null, "description": one short sentence or null}',
      },
    ],
    // JSON mode without responseSchema — with a schema, 3.5-flash stalled (see gemini_utils.py).
    generationConfig: { maxOutputTokens: 512, responseMimeType: "application/json" },
  });
  if ("error" in result) return json({ landmark: null, error: result.error });

  try {
    const parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    console.log(`[recognize-landmark] ok model=${result.model} landmark=${str(parsed.landmark)}`);
    return json({ landmark: str(parsed.landmark), confidence: str(parsed.confidence), description: str(parsed.description) });
  } catch {
    return json({ landmark: null, error: "The AI gave an unreadable answer. Please try again." });
  }
}
