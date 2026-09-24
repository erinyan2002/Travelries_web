// Base URL of the optional FastAPI backend (backend/main.py). Set
// NEXT_PUBLIC_BACKEND_URL (e.g. in Vercel's env settings) to a deployed backend —
// the localhost default only works when the browser runs on the same machine as
// the backend, so a deployed site without it silently falls back to browser mode.
// NEXT_PUBLIC_* is inlined at build time: redeploy after changing it.
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000").replace(/\/+$/, "");
