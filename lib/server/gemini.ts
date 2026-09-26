// Gemini REST calls for the Next.js API routes (AI diary, landmark), with the same
// model fallback as backend/utils/gemini_utils.py. Server-only: reads GOOGLE_API_KEY.
import { createClient } from "@supabase/supabase-js";

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
        lastError = `HTTP ${res.status}`;
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
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  console.warn(`[gemini] all models failed: ${lastError}`);
  return { error: "The AI service is busy right now. Please try again in a minute." };
}
