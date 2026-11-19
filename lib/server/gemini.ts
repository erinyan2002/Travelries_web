// Gemini REST calls for the Next.js API routes (AI diary, landmark), with the same
// model fallback as backend/utils/gemini_utils.py. Server-only: reads GOOGLE_API_KEY.
import { createClient } from "@supabase/supabase-js";

// Tried in order; a busy, slow or missing model falls through to the next one.
// gemini-3.5-flash often answers 503 "high demand", so the lite models behind it
// carry most requests. (The 2.5 models are closed to new keys: 404.)
const MODEL_CHAIN: { model: string; thinking?: string }[] = [
  { model: "gemini-3.5-flash", thinking: "MINIMAL" },
  { model: "gemini-3.5-flash-lite" },
  { model: "gemini-3.1-flash-lite" },
  { model: "gemini-flash-lite-latest" },
];
// A diary sends up to 8 full photos, which a lite model can take 10-20 s to read,
// so one call may use up to 25 s, within an overall budget under the route's 60 s.
const PER_CALL_TIMEOUT_MS = 25_000;
const TOTAL_BUDGET_MS = 52_000;
const FALLTHROUGH = new Set([404, 429, 500, 502, 503, 504]);
// Short: a 5-minute cooldown left every request for minutes with only the last
// model, so one busy spell showed "AI is busy" to everyone.
const COOLDOWN_MS = 60_000;
const cooldownUntil = new Map<string, number>(); // per server instance

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

/** The signed-in user's id from the Bearer token, or null — so the API key can't be used by anyone on the internet. */
export async function authedUserId(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await supabase.auth.getUser(token);
  return user?.id ?? null;
}

export type GeminiResult = { text: string; model: string } | { error: string };

export async function generateWithFallback(
  key: string,
  request: { systemText?: string; parts: object[]; generationConfig?: Record<string, unknown> },
): Promise<GeminiResult> {
  const start = Date.now();
  // A pasted env value can carry a trailing newline, which breaks the header.
  key = key.trim();
  const ready = MODEL_CHAIN.filter((m) => (cooldownUntil.get(m.model) ?? 0) <= start);
  let lastError = "";
  for (const { model, thinking } of ready.length > 0 ? ready : MODEL_CHAIN) {
    const left = TOTAL_BUDGET_MS - (Date.now() - start);
    if (left < 3_000) break;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(Math.min(PER_CALL_TIMEOUT_MS, left)),
        body: JSON.stringify({
          ...(request.systemText && { systemInstruction: { parts: [{ text: request.systemText }] } }),
          contents: [{ role: "user", parts: request.parts }],
          generationConfig: {
            ...request.generationConfig,
            ...(thinking && { thinkingConfig: { thinkingLevel: thinking } }),
          },
        }),
      });
      if (FALLTHROUGH.has(res.status)) {
        cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
        lastError = `${model}: HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      if (!res.ok) return { error: data?.error?.message ?? `AI request failed (${res.status}).` };
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (!text) return { error: "The AI didn't answer this time. Please try again." };
      return { text, model };
    } catch (err) {
      // timeout → next model
      cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
      lastError = `${model}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  console.warn(`[gemini] all models failed: ${lastError}`);
  return { error: "The AI service is busy right now. Please try again in a minute." };
}
